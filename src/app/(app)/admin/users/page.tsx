import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CreateUserForm, AssignSiteForm, ChangePasswordForm, ChangeEmailForm, RemoveUserForm } from "./UserForms";

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    superadmin: "bg-danger-soft text-danger",
    admin: "bg-accent-soft text-accent-strong",
    supervisor: "bg-accent-soft text-accent-strong",
  };
  const labels: Record<string, string> = {
    superadmin: "Superadmin",
    admin: "Admin",
    supervisor: "Store Manager",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[role] ?? "bg-surface-2 text-ink-2"}`}>
      {labels[role] ?? role}
    </span>
  );
}

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const callerRole = me?.role ?? null;
  if (callerRole !== "admin" && callerRole !== "superadmin") redirect("/dashboard");

  const isSuperadmin = callerRole === "superadmin";

  const [{ data: profiles }, { data: projects }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, home_project_id, project:home_project_id(code, name)")
      .order("full_name"),
    supabase.from("projects").select("id, code, name").order("code"),
  ]);

  type ProfileRow = {
    id: string;
    full_name: string | null;
    role: string;
    home_project_id: string | null;
    project: { code: string; name: string } | null;
  };

  const rows = (profiles ?? []) as unknown as ProfileRow[];
  const allProjects = projects ?? [];

  // Any admin/superadmin reaching this page may see usernames (emails).
  const admin = createAdminClient();
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map((userList?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">User accounts</h1>
        <p className="mt-1 text-sm text-ink-2">
          Create accounts and assign each store manager to their home site.
        </p>
      </div>

      {/* Existing users */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">All users</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Username (email)</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Assigned site</th>
                <th className="py-2 pr-4">Change site</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const canEdit = p.role === "supervisor" || p.role === "admin";
                // Admins & superadmins can manage any non-superadmin account except their own.
                const canManage = p.id !== user.id && p.role !== "superadmin";
                return (
                  <tr key={p.id} className="border-b border-line">
                    <td className="py-2.5 pr-4 font-medium text-ink">
                      {p.full_name ?? <span className="text-ink-3">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-ink-2">
                      {emailById.get(p.id) || <span className="text-ink-3">—</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      <RoleBadge role={p.role} />
                    </td>
                    <td className="py-2.5 pr-4 text-ink-2">
                      {p.project
                        ? `${p.project.code} — ${p.project.name}`
                        : <span className="text-ink-3">Not assigned</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      {canEdit && (
                        <AssignSiteForm
                          userId={p.id}
                          currentProjectId={p.home_project_id}
                          projects={allProjects}
                        />
                      )}
                    </td>
                    <td className="py-2.5">
                      {canManage && (
                        <div className="flex items-center gap-3">
                          <ChangeEmailForm userId={p.id} currentEmail={emailById.get(p.id) ?? ""} />
                          <ChangePasswordForm userId={p.id} />
                          <RemoveUserForm userId={p.id} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create new account */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-1 text-base font-semibold">Create new account</h2>
        <p className="mb-4 text-xs text-ink-2">
          The account is active immediately — the user can log in with these credentials right away.
          {isSuperadmin && " As superadmin you can create both admin and store manager accounts."}
        </p>
        <CreateUserForm projects={allProjects} isSuperadmin={isSuperadmin} />
      </section>
    </div>
  );
}
