import type { SupabaseClient } from "@supabase/supabase-js";

/* Monthly diesel-consumption report — one row per machine, summed over a
   calendar month, grouped by site. Built for the admin's monthly
   submission: total liters and cost per machine per site, plus the
   opening/closing reading span for the month. */

export interface MonthlyReportRow {
  project_id: string;
  site_label: string;
  machine_id: string;
  machine_name: string;
  registration_no: string | null;
  reading_type: "km" | "hours";
  opening_reading: number | null;
  closing_reading: number | null;
  total_fuel: number;
  total_cost: number;
  /** Portion of the above drawn from the sister company (Shraddha) pump —
      for reconciliation against their records. Zero at non-Shraddha sites. */
  shraddha_fuel: number;
  shraddha_cost: number;
  days_reported: number;
  /** Fuel counted from the day `opening_reading` was actually established
      onward — used ONLY for rowAverage, never for cost/register totals.
      A machine's very first log ever (or a brand-new machine filed before
      its first reading was set) can carry fuel with no opening reading at
      all, so that fill has no measurable distance to divide by. Equal to
      total_fuel except in that edge case — see rowAverage for why counting
      it there would understate efficiency, not overstate it. */
  measured_fuel: number;
}

/** "YYYY-MM" → the month's first and last calendar dates (YYYY-MM-DD). */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(y, m, 0).toISOString().slice(0, 10);
  return { start, end };
}

export async function fetchMonthlyReport(
  supabase: SupabaseClient,
  start: string,
  end: string,
  siteFilter: string | null,
): Promise<MonthlyReportRow[]> {
  let query = supabase
    .from("daily_logs")
    .select("machine_id, project_id, log_date, opening_reading, closing_reading, fuel_issued_liters, total_cost, fuel_source")
    .gte("log_date", start)
    .lte("log_date", end)
    .order("log_date", { ascending: true });
  if (siteFilter) query = query.eq("project_id", siteFilter);

  const { data: logsRaw } = await query;
  const logs = (logsRaw ?? []) as {
    machine_id: string;
    project_id: string;
    log_date: string;
    opening_reading: number | null;
    closing_reading: number | null;
    fuel_issued_liters: number;
    total_cost: number | null;
    fuel_source: "shraddha" | "outside" | null;
  }[];
  if (logs.length === 0) return [];

  const machineIds = [...new Set(logs.map((l) => l.machine_id))];
  const projectIds = [...new Set(logs.map((l) => l.project_id))];

  const [{ data: machinesRaw }, { data: projectsRaw }] = await Promise.all([
    supabase
      .from("machines")
      .select("id, name, registration_no, reading_type")
      .in("id", machineIds),
    supabase.from("projects").select("id, name, code").in("id", projectIds),
  ]);
  const machineById = new Map(
    (machinesRaw ?? []).map((m) => [m.id as string, m as { name: string; registration_no: string | null; reading_type: "km" | "hours" }]),
  );
  const projectById = new Map(
    (projectsRaw ?? []).map((p) => [p.id as string, p as { name: string; code: string | null }]),
  );

  const grouped = new Map<string, MonthlyReportRow>();
  for (const l of logs) {
    if (!grouped.has(l.machine_id)) {
      const m = machineById.get(l.machine_id);
      const p = projectById.get(l.project_id);
      grouped.set(l.machine_id, {
        project_id: l.project_id,
        site_label: p ? (p.code ? `${p.code} · ${p.name}` : p.name) : "—",
        machine_id: l.machine_id,
        machine_name: m?.name ?? "—",
        registration_no: m?.registration_no ?? null,
        reading_type: m?.reading_type ?? "km",
        opening_reading: l.opening_reading,
        closing_reading: l.closing_reading,
        total_fuel: 0,
        total_cost: 0,
        shraddha_fuel: 0,
        shraddha_cost: 0,
        days_reported: 0,
        measured_fuel: 0,
      });
    }
    const row = grouped.get(l.machine_id)!;
    // Logs arrive oldest-first, so the earliest non-null opening and the
    // latest non-null closing bracket the whole month's reading span. Note
    // WHICH row supplies that opening (openingKnown flips true on it) —
    // that's the point measured_fuel starts counting from.
    const openingKnown = row.opening_reading != null;
    if (row.opening_reading == null) row.opening_reading = l.opening_reading;
    if (l.closing_reading != null) row.closing_reading = l.closing_reading;
    const fuel = Number(l.fuel_issued_liters);
    const cost = Number(l.total_cost ?? 0);
    row.total_fuel += fuel;
    row.total_cost += cost;
    // True total (above) always includes this fuel — the register and the
    // grand totals need every liter, whether or not it lands inside a
    // measurable span. measured_fuel only starts once an opening reading is
    // on record, INCLUDING the very row that establishes it.
    if (openingKnown || l.opening_reading != null) row.measured_fuel += fuel;
    if (l.fuel_source === "shraddha") {
      row.shraddha_fuel += fuel;
      row.shraddha_cost += cost;
    }
    row.days_reported += 1;
  }

  return [...grouped.values()].sort(
    (a, b) => a.site_label.localeCompare(b.site_label) || a.machine_name.localeCompare(b.machine_name),
  );
}

/** Distance/hours covered across the whole range (closing − opening), or
    null if either end is missing or the machine went backwards. */
export function rowTotalRun(r: MonthlyReportRow): number | null {
  if (r.opening_reading == null || r.closing_reading == null) return null;
  const run = r.closing_reading - r.opening_reading;
  return run > 0 ? run : null;
}

/** Average efficiency over the range — km/L for odometer machines,
    L/hr for hour-metered ones — or null if there's not enough data.

    Uses measured_fuel, not total_fuel: rowTotalRun measures distance from
    the day an opening reading was first recorded, and any fuel logged
    before that (a machine's very first entry ever, before any prior
    reading existed to carry forward) covered ground this range can't see.
    Dividing the FULL fuel total by that partial distance would understate
    efficiency — the average would look worse than the vehicle actually is,
    for a reason that has nothing to do with how it's running. */
export function rowAverage(r: MonthlyReportRow): number | null {
  const run = rowTotalRun(r);
  if (run == null || r.measured_fuel <= 0) return null;
  return r.reading_type === "hours" ? r.measured_fuel / run : run / r.measured_fuel;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: MonthlyReportRow[]): string {
  const header = [
    "Site",
    "Machine",
    "Numberplate",
    "Opening",
    "Closing",
    "Fuel (L)",
    "Cost (INR)",
    "Total run (km/hr)",
    "Average (km/L or L/hr)",
    "Shraddha pump fuel (L)",
    "Shraddha pump cost (INR)",
    "Days reported",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const total = rowTotalRun(r);
    const avg = rowAverage(r);
    lines.push(
      [
        csvEscape(r.site_label),
        csvEscape(r.machine_name),
        csvEscape(r.registration_no ?? ""),
        csvEscape(r.opening_reading ?? ""),
        csvEscape(r.closing_reading ?? ""),
        csvEscape(r.total_fuel.toFixed(2)),
        csvEscape(r.total_cost.toFixed(2)),
        csvEscape(total != null ? total.toFixed(2) : ""),
        csvEscape(avg != null ? avg.toFixed(2) : ""),
        csvEscape(r.shraddha_fuel.toFixed(2)),
        csvEscape(r.shraddha_cost.toFixed(2)),
        csvEscape(r.days_reported),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}
