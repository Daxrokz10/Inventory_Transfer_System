"use server";

import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Mark one notification (or, without an id, all of them) as read. RLS limits
    this to the caller's own rows. */
export async function markNotificationsRead(id?: number): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;
  const supabase = await createClient();
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
  if (id !== undefined) q = q.eq("id", id);
  await q;
}
