import { createAdminClient } from "@/lib/supabase/admin";

/* Ordinary users carry no title; only the two elevated Inventory roles are
   worth spelling out next to a name. */
const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
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
    label: ROLE_LABEL[p.role]
      ? `${p.full_name ?? "Unnamed user"} (${ROLE_LABEL[p.role]})`
      : (p.full_name ?? "Unnamed user"),
    // Interviewer access is switched on per user in the Control Panel; the
    // superadmin has every access.
    canInterview: p.role === "superadmin" || Boolean(p.hr_interviewer),
  }));
}
