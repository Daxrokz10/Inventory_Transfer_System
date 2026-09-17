import { createAdminClient } from "@/lib/supabase/admin";

const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  supervisor: "Store Manager",
  hr: "HR",
};

/** Every app user, for the interviewer picker and name lookups. Profiles RLS
    only lets admins list other users, so HR staff read through the service
    role (names and roles only). */
export async function listPeople(): Promise<{ id: string; name: string; label: string; canInterview: boolean }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id, full_name, role, hr_interviewer").order("full_name");
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name ?? "Unnamed user",
    label: `${p.full_name ?? "Unnamed user"} (${ROLE_LABEL[p.role] ?? p.role})`,
    // Interviewer access is switched on per user in the Control Panel; the
    // superadmin has every access.
    canInterview: p.role === "superadmin" || Boolean(p.hr_interviewer),
  }));
}
