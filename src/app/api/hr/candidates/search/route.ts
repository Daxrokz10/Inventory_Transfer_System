import { NextResponse } from "next/server";
import { getAccess, getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Candidate lookup for the "tag a candidate" box: a few matches by name,
    phone or ID. HR staff only — it reads the candidate list. */
export async function GET(request: Request) {
  const [user, access] = await Promise.all([getAuthUser(), getAccess()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.hrStaff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().replace(/[,()%]/g, " ");
  if (q.length < 2) return NextResponse.json({ items: [] });

  const supabase = await createClient();
  const { data } = await supabase
    .from("hr_candidates")
    .select("id, candidate_code, name, designation, phone, status, opening_code")
    .or(`name.ilike.%${q}%,candidate_code.ilike.%${q}%,phone.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(8);

  return NextResponse.json({ items: data ?? [] });
}
