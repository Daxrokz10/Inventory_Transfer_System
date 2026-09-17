import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardLabel } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { TD, TH, TRow, Table } from "@/components/ui/Table";
import { getAccess, getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AssignSiteForm,
  ChangeEmailForm,
  ChangePasswordForm,
  RemoveUserForm,
} from "../admin/users/UserForms";
import { AccessToggle, CreateUserWithAccessForm } from "./ConsoleForms";
import { ACCESS_FLAGS, ACCESS_LABELS } from "./constants";

type Row = {
  id: string;
  full_name: string | null;
  role: string;
  home_project_id: string | null;
  can_inventory: boolean;
  can_diesel: boolean;
  hr_staff: boolean;
  hr_interviewer: boolean;
  hr_planning: boolean;
};

const TILES = [
  { href: "/dashboard", label: "Inventory", sub: "Transfers, stock & purchases" },
  { href: "/diesel", label: "Diesel", sub: "Fuel, machinery & anomalies" },
  { href: "/hr", label: "HR", sub: "Candidates, interviews & openings" },
];

export default async function ConsolePage() {
  const [user, access] = await Promise.all([getAuthUser(), getAccess()]);
  if (!user) redirect("/login");
  if (!access.superadmin) redirect("/");

  // Service role: the list needs every profile plus auth emails.
  const admin = createAdminClient();
  const [{ data: profiles, error }, { data: projects }, { data: authUsers }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, role, home_project_id, can_inventory, can_diesel, hr_staff, hr_interviewer, hr_planning")
      .order("full_name"),
    admin.from("projects").select("id, code, name").eq("is_active", true).order("code"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const rows = (profiles ?? []) as Row[];

  return (
    <div className="space-y-6">
      <PageHeader title="Control Panel" subtitle="Users, credentials and module access for the whole suite." />

      <div className="grid gap-3 sm:grid-cols-3">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-lg border border-line bg-surface p-5 shadow-sm transition-colors hover:border-accent hover:bg-accent-soft"
          >
            <p className="text-lg font-semibold text-ink">{t.label} →</p>
            <p className="text-sm text-ink-2">{t.sub}</p>
          </Link>
        ))}
      </div>

      {error && (
        <p className="rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">
          Module access columns are missing — run migration 0035_access_hr_v2.sql in Supabase. ({error.message})
        </p>
      )}

      <Card className="overflow-x-auto p-0">
        <div className="px-5 pt-4">
          <CardLabel>Users · {rows.length}</CardLabel>
          <p className="mt-1 text-xs text-ink-3">Access boxes save as soon as you click them.</p>
        </div>
        <Table className="mt-3">
          <thead>
            <tr>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Site</TH>
              {ACCESS_FLAGS.map((f) => (
                <TH key={f} className="text-center">
                  {ACCESS_LABELS[f]}
                </TH>
              ))}
              <TH>Credentials</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const isSuper = p.role === "superadmin";
              return (
                <TRow key={p.id}>
                  <TD className="whitespace-nowrap font-medium">
                    {p.full_name ?? "—"}
                    {isSuper && <span className="ml-2 text-xs font-semibold text-danger">Superadmin</span>}
                    {p.role === "admin" && <span className="ml-2 text-xs font-semibold text-accent">Admin</span>}
                  </TD>
                  <TD className="whitespace-nowrap text-ink-2">{emailById.get(p.id) || "—"}</TD>
                  <TD>
                    {isSuper ? (
                      "—"
                    ) : (
                      <AssignSiteForm userId={p.id} currentProjectId={p.home_project_id} projects={projects ?? []} />
                    )}
                  </TD>
                  {ACCESS_FLAGS.map((f) => (
                    <TD key={f} className="text-center">
                      {isSuper ? (
                        <span className="text-xs text-ink-3">all</span>
                      ) : (
                        <AccessToggle userId={p.id} flag={f} value={Boolean(p[f])} />
                      )}
                    </TD>
                  ))}
                  <TD>
                    {isSuper ? null : (
                      <div className="flex flex-wrap items-center gap-3">
                        <ChangeEmailForm userId={p.id} currentEmail={emailById.get(p.id) ?? ""} />
                        <ChangePasswordForm userId={p.id} />
                        <RemoveUserForm userId={p.id} />
                      </div>
                    )}
                  </TD>
                </TRow>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card className="space-y-3">
        <CardLabel>Create user</CardLabel>
        <CreateUserWithAccessForm projects={projects ?? []} />
      </Card>
    </div>
  );
}
