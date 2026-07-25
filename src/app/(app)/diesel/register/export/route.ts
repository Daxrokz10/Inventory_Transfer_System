import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildDieselRegister, registerToCsv } from "@/lib/diesel/register";
import { monthRange } from "@/lib/diesel/monthlyReport";

// CSV of a site's diesel register for a month — same columns as the manual
// DIESEL_REG tab. RLS scopes the underlying reads to the caller's own site
// (or admin), so the site param is only honoured when the caller may see it.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, home_project_id")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const site = isAdmin ? searchParams.get("site") : profile?.home_project_id ?? null;
  if (!site) return new Response("No site", { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Invalid month", { status: 400 });

  const { start, end } = monthRange(month);
  const register = await buildDieselRegister(supabase, site, { start, end });
  const csv = registerToCsv(register);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="diesel-register-${month}.csv"`,
    },
  });
}
