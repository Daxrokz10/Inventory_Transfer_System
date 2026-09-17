import { createAdminClient } from "@/lib/supabase/admin";

export type NewNotification = {
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
};

/** Send an in-app notification to each user. Never throws: a failed
    notification must not undo the action that triggered it. */
export async function notify(userIds: string[], n: NewNotification): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("notifications").insert(
      ids.map((user_id) => ({ user_id, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null })),
    );
    if (error) console.error("notify failed:", error.message);
  } catch (e) {
    console.error("notify failed:", e);
  }
}

/** Everyone with HR staff access; falls back to the superadmin when no HR
    staff are set up yet, so a new opening never goes unseen. */
export async function hrStaffIds(): Promise<string[]> {
  const admin = createAdminClient();
  const { data: staff } = await admin.from("profiles").select("id").eq("hr_staff", true);
  if (staff?.length) return staff.map((p) => p.id);
  const { data: supers } = await admin.from("profiles").select("id").eq("role", "superadmin");
  return (supers ?? []).map((p) => p.id);
}
