import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchMonthlyReport, toCsv } from "@/lib/diesel/monthlyReport";

// Admin-only CSV download of the monthly per-site, per-machine diesel
// consumption report — same data as the /diesel/reports page, exported
// for the monthly submission.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  if (!isAdmin) return new Response("Forbidden", { status: 403 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const site = searchParams.get("site") || null;
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Invalid month", { status: 400 });

  const rows = await fetchMonthlyReport(supabase, month, site);
  const csv = toCsv(rows);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="diesel-report-${month}.csv"`,
    },
  });
}
