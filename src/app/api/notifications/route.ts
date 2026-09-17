import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The signed-in user's unread count and latest notifications (polled by the bell). */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const [{ count }, { data, error }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
    supabase
      .from("notifications")
      .select("id, kind, title, body, link, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  // Table not created yet (migration 0037 not run): behave as "no notifications".
  if (error) return NextResponse.json({ unread: 0, items: [] });

  return NextResponse.json({ unread: count ?? 0, items: data ?? [] });
}
