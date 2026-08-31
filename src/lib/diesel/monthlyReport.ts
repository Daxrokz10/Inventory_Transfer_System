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
  /** Fuel AND distance counted for rowAverage only — excludes both ends of
      the range where the true efficiency isn't knowable yet.
      Fuel is dispensed AFTER that day's trip is already done, so a fill
      doesn't power the distance it's logged alongside — it powers
      whatever comes next, until the tank is topped up again. So:
        - distance before the FIRST fill in range isn't attributed to any
          fuel we have a record of (it ran on fuel logged earlier, outside
          this range) — measured_run starts at the first fill's closing
          reading, not the range's opening reading;
        - the LAST fill's fuel powers a leg that hasn't happened yet, so
          it's excluded from measured_fuel — same "provisional" concept
          the efficiency chart (efficiency.ts) applies to its most recent
          fill, just applied here too. A later report resolves it, at
          which point it's no longer the last fill and counts normally.
      Deliberately NOT applied to total_fuel/total_cost — every liter still
      counts toward cost and the register regardless of whether its
      distance is resolved yet. */
  measured_fuel: number;
  /** Distance/hours behind measured_fuel — the span from opening_reading to
      the last reading NOT excluded as provisional. Nullable the same way
      rowTotalRun is (not enough resolved data to measure). */
  measured_run: number | null;
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
  // Supabase/PostgREST caps any query with no explicit range at 1000 rows —
  // silently, with no error. A full month across every site routinely
  // exceeds that (August 2026 alone is 1300+), which was truncating the
  // report and its CSV export partway through the month with no sign
  // anything was cut. Page through in chunks of 1000 until a page comes
  // back short, so the whole range is always fetched regardless of size.
  type LogRow = {
    machine_id: string;
    project_id: string;
    log_date: string;
    opening_reading: number | null;
    closing_reading: number | null;
    fuel_issued_liters: number;
    total_cost: number | null;
    fuel_source: "shraddha" | "outside" | null;
  };
  const PAGE_SIZE = 1000;
  const logs: LogRow[] = [];
  for (let page = 0; ; page++) {
    let query = supabase
      .from("daily_logs")
      .select("machine_id, project_id, log_date, opening_reading, closing_reading, fuel_issued_liters, total_cost, fuel_source")
      .gte("log_date", start)
      .lte("log_date", end)
      .order("log_date", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (siteFilter) query = query.eq("project_id", siteFilter);
    const { data: pageRows } = await query;
    logs.push(...((pageRows ?? []) as LogRow[]));
    if (!pageRows || pageRows.length < PAGE_SIZE) break;
  }
  if (logs.length === 0) return [];

  const machineIds = [...new Set(logs.map((l) => l.machine_id))];
  const projectIds = [...new Set(logs.map((l) => l.project_id))];

  const [{ data: machinesRaw }, { data: projectsRaw }] = await Promise.all([
    supabase
      .from("machines")
      .select("id, name, registration_no, reading_type, fuel_type")
      .in("id", machineIds),
    supabase.from("projects").select("id, name, code").in("id", projectIds),
  ]);
  const machineById = new Map(
    (machinesRaw ?? []).map((m) => [
      m.id as string,
      m as { name: string; registration_no: string | null; reading_type: "km" | "hours"; fuel_type: "diesel" | "petrol" },
    ]),
  );
  const projectById = new Map(
    (projectsRaw ?? []).map((p) => [p.id as string, p as { name: string; code: string | null }]),
  );

  const grouped = new Map<string, MonthlyReportRow>();
  // Kept alongside the totals above so measured_fuel/measured_run can be
  // derived in a second pass, once every row for a machine is in hand —
  // excluding the most recent one needs to know it WAS the most recent,
  // which isn't knowable while still accumulating a running total.
  const rawByMachine = new Map<string, typeof logs>();

  for (const l of logs) {
    // This is the DIESEL report — a petrol-fueled machine's fuel never
    // touched the site's diesel barrel (same exclusion register.ts already
    // applies to the Diesel Register), so it's skipped here too rather than
    // inflating totals meant for the diesel monthly submission.
    if (machineById.get(l.machine_id)?.fuel_type === "petrol") continue;
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
        measured_run: null,
      });
      rawByMachine.set(l.machine_id, []);
    }
    const row = grouped.get(l.machine_id)!;
    // Logs arrive oldest-first, so the earliest non-null opening and the
    // latest non-null closing bracket the whole month's reading span.
    if (row.opening_reading == null) row.opening_reading = l.opening_reading;
    if (l.closing_reading != null) row.closing_reading = l.closing_reading;
    const fuel = Number(l.fuel_issued_liters);
    const cost = Number(l.total_cost ?? 0);
    row.total_fuel += fuel;
    row.total_cost += cost;
    if (l.fuel_source === "shraddha") {
      row.shraddha_fuel += fuel;
      row.shraddha_cost += cost;
    }
    row.days_reported += 1;
    rawByMachine.get(l.machine_id)!.push(l);
  }

  // Second pass: measured_fuel/measured_run. Each fill's fuel powers the
  // leg AFTER it (dispensed once that day's trip is already done), so
  // pairing runs fill-to-fill on closing readings, not opening-to-latest.
  for (const row of grouped.values()) {
    const raw = rawByMachine.get(row.machine_id)!; // already oldest-first
    const fillRows = raw.filter((l) => Number(l.fuel_issued_liters) > 0 && l.closing_reading != null);
    if (fillRows.length < 2) continue; // need one fill to start the clock, one to end it
    // Every fill except the last: its fuel's leg is already resolved by a
    // later fill's closing reading. The last fill's leg hasn't happened yet.
    const resolvedFills = fillRows.slice(0, -1);
    row.measured_fuel = resolvedFills.reduce((s, l) => s + Number(l.fuel_issued_liters), 0);
    const firstClosing = Number(fillRows[0].closing_reading);
    const lastClosing = Number(fillRows[fillRows.length - 1].closing_reading);
    const run = lastClosing - firstClosing;
    row.measured_run = run > 0 ? run : null;
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

    Deliberately uses measured_run/measured_fuel, NOT rowTotalRun/total_fuel:
    those include fuel with no opening reading behind it (a machine's very
    first entry ever) and the range's most recent report, whose outcome
    isn't confirmed yet. Both would be counted as consumed with no matching
    distance, understating efficiency for reasons that have nothing to do
    with how the machine is actually running. rowTotalRun/total_fuel still
    do their job elsewhere — the full physical span and every liter spent,
    cost and register totals need exactly that, unadjusted. */
export function rowAverage(r: MonthlyReportRow): number | null {
  if (r.measured_run == null || r.measured_fuel <= 0) return null;
  return r.reading_type === "hours"
    ? r.measured_fuel / r.measured_run
    : r.measured_run / r.measured_fuel;
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
