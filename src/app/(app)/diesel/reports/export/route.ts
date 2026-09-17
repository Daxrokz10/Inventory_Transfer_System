import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchMonthlyReport, toCsv } from "@/lib/diesel/monthlyReport";
import { getAuthUser, getProfile, getAccess } from "@/lib/auth";

// Admin-only CSV download of the monthly per-site, per-machine diesel
// consumption report — same data as the /diesel/reports page, exported
// for the monthly submission.
export async function GET(req: NextRequest) {
  if (!(await getAccess()).diesel) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const profile = await getProfile();
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  if (!isAdmin) return new Response("Forbidden", { status: 403 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const start = searchParams.get("start") || monthStart;
  const end = searchParams.get("end") || today;
  const site = searchParams.get("site") || null;
  const fuel = searchParams.get("fuel") === "petrol" ? "petrol" : "diesel";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return new Response("Invalid date range", { status: 400 });
  }

  const rows = await fetchMonthlyReport(supabase, start, end, site, fuel);
  const csv = toCsv(rows);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fuel}-report-${start}_to_${end}.csv"`,
    },
  });
}
