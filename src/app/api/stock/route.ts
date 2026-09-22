import { getAccess } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/selectAll";

export async function GET(req: NextRequest) {
  if (!(await getAccess()).inventory) {
    return new Response("Forbidden", { status: 403 });
  }

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    // stock_balances is item x site, so one site's slice still grows with
    // the item master — paged rather than silently cut at 1000.
    const data = await selectAll<{ item_id: string; on_hand: number }>(() =>
      supabase.from("stock_balances").select("item_id, on_hand").eq("project_id", projectId),
    );
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load stock" },
      { status: 500 },
    );
  }
}
