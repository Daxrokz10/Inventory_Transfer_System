import type { SupabaseClient } from "@supabase/supabase-js";

/* Diesel register — the site's running barrel-stock ledger, merging the two
   sides we already record into one chronological stream:

     INWARD   = fuel_receipts   (barrels bought — vendor, liters, rate, cost)
     OUTWARD  = daily_logs      (diesel issued to a machine — liters, readings)

   running_balance = opening_stock + Σ inward − Σ outward, up to and including
   each row. Anchored by a one-time opening count (diesel_opening_stock) so the
   balance is meaningful from go-live; without it, opening is treated as 0.

   This mirrors the manual "DIESEL_REG" Excel tab. It is a shown figure, not a
   control — nothing alerts or blocks on a shortfall. Outward is one row per
   machine per day (same-day fills summed), matching the one-entry-per-day rule. */

export interface RegisterRow {
  date: string;
  type: "INWARD" | "OUTWARD";
  /** INTERNAL / EXTERNAL for outward; vendor's diesel is EXTERNAL for inward. */
  subGroup: "INTERNAL" | "EXTERNAL" | "";
  party: string; // inward: fuel vendor · outward: machine owner (SGC / vendor)
  machine: string; // outward only
  assetCode: string; // outward only (numberplate / code)
  liters: number;
  rate: number | null; // inward only
  amount: number | null; // inward only
  startReading: number | null; // outward only
  endReading: number | null; // outward only
  meterBroken: boolean; // outward: reading unavailable (dead meter)
  /** Outward only. Where the fuel came from, relative to THIS site's own
      barrel stock — null/"on_site" fills are drawn from delivered barrels
      and reduce the balance; "shraddha"/"outside" fills never touched this
      site's stock, so they're listed but don't move the balance. */
  fuelSource: "on_site" | "shraddha" | "outside" | null;
  runningBalance: number;
  note: string | null;
}

export interface RegisterResult {
  rows: RegisterRow[];
  openingStock: number;
  openingAsOf: string | null;
  /** Balance carried into the displayed range from all prior movements. */
  broughtForward: number;
  inwardLiters: number;
  inwardAmount: number;
  /** Outward liters drawn from THIS site's own stock — what actually moves
      the balance. */
  outwardLiters: number;
  /** Outward liters filled at Shraddha's pump or offsite — never touched
      this site's stock, shown for context but excluded from the balance. */
  outwardNotFromStockLiters: number;
  closingBalance: number;
}

export interface DateRange {
  /** First date shown. Movements before this still count toward the balance
      (as broughtForward) but aren't listed. */
  start: string;
  end: string;
}

export async function buildDieselRegister(
  supabase: SupabaseClient,
  projectId: string,
  range: DateRange,
): Promise<RegisterResult> {
  // Opening anchor for this site (latest physical count).
  const { data: opening } = await supabase
    .from("diesel_opening_stock")
    .select("liters, as_of")
    .eq("project_id", projectId)
    .maybeSingle();
  const openingStock = opening ? Number(opening.liters) : 0;
  const openingAsOf = opening?.as_of ?? null;

  // Fetch EVERYTHING up to the range end (no lower bound) so the running
  // balance reflects all prior movements; the range only controls what's
  // listed. INWARD — barrels received. This ledger is diesel-only — a
  // petrol receipt is a separate fuel stock and would otherwise silently
  // inflate this balance.
  const { data: receiptsRaw } = await supabase
    .from("fuel_receipts")
    .select("receipt_date, liters, rate_per_liter, total_cost, vendor, note")
    .eq("project_id", projectId)
    .eq("fuel_type", "diesel")
    .lte("receipt_date", range.end);

  // OUTWARD — diesel issued to machines. Join the machine for
  // name/plate/owner/fuel — a petrol-fueled machine's log never touched
  // this site's diesel stock, so it's excluded below rather than counted.
  const { data: logsRaw } = await supabase
    .from("daily_logs")
    .select(
      "log_date, fuel_issued_liters, opening_reading, closing_reading, fuel_source, machines(name, registration_no, ownership, vendor_name, fuel_type)",
    )
    .eq("project_id", projectId)
    .gt("fuel_issued_liters", 0)
    .lte("log_date", range.end);

  type LogRow = {
    log_date: string;
    fuel_issued_liters: number;
    opening_reading: number | null;
    closing_reading: number | null;
    fuel_source: "on_site" | "shraddha" | "outside" | null;
    machines: {
      name: string;
      registration_no: string | null;
      ownership: "internal" | "external";
      vendor_name: string | null;
      fuel_type: "diesel" | "petrol";
    } | null;
  };

  const inward: RegisterRow[] = ((receiptsRaw ?? []) as {
    receipt_date: string;
    liters: number;
    rate_per_liter: number | null;
    total_cost: number | null;
    vendor: string | null;
    note: string | null;
  }[]).map((r) => ({
    date: r.receipt_date,
    type: "INWARD" as const,
    subGroup: "EXTERNAL" as const,
    party: r.vendor ?? "—",
    machine: "",
    assetCode: "",
    liters: Number(r.liters),
    rate: r.rate_per_liter != null ? Number(r.rate_per_liter) : null,
    amount: r.total_cost != null ? Number(r.total_cost) : null,
    startReading: null,
    endReading: null,
    meterBroken: false,
    fuelSource: null,
    runningBalance: 0,
    note: r.note,
  }));

  const outward: RegisterRow[] = ((logsRaw ?? []) as unknown as LogRow[])
    .filter((l) => (l.machines?.fuel_type ?? "diesel") === "diesel")
    .map((l) => {
      const m = l.machines;
      const owner = m?.ownership === "external" ? (m.vendor_name ?? "Hired") : "SGC";
      return {
        date: l.log_date,
        type: "OUTWARD" as const,
        subGroup: (m?.ownership === "external" ? "EXTERNAL" : "INTERNAL") as
          | "INTERNAL"
          | "EXTERNAL",
        party: owner,
        machine: m?.name ?? "—",
        assetCode: m?.registration_no ?? "",
        liters: Number(l.fuel_issued_liters),
        rate: null,
        amount: null,
        startReading: l.opening_reading != null ? Number(l.opening_reading) : null,
        endReading: l.closing_reading != null ? Number(l.closing_reading) : null,
        meterBroken: l.closing_reading == null,
        fuelSource: l.fuel_source,
        runningBalance: 0,
        note: null,
      };
    });

  // Merge chronologically; inward before outward on the same date (barrels
  // land, then get issued). Then thread the running balance from opening.
  const all = [...inward, ...outward].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.type !== b.type) return a.type === "INWARD" ? -1 : 1;
    return 0;
  });

  let balance = openingStock;
  let broughtForward = openingStock;
  let inwardLiters = 0;
  let inwardAmount = 0;
  let outwardLiters = 0;
  let outwardNotFromStockLiters = 0;
  const rows: RegisterRow[] = [];
  for (const row of all) {
    const shown = row.date >= range.start;
    if (row.type === "INWARD") {
      balance += row.liters;
      if (shown) {
        inwardLiters += row.liters;
        inwardAmount += row.amount ?? 0;
      }
    } else {
      // Only a fill drawn from this site's own barrels moves the balance —
      // a Shraddha-pump or offsite fill never touched this site's stock.
      const fromStock = row.fuelSource == null || row.fuelSource === "on_site";
      if (fromStock) balance -= row.liters;
      if (shown) {
        if (fromStock) outwardLiters += row.liters;
        else outwardNotFromStockLiters += row.liters;
      }
    }
    if (shown) {
      row.runningBalance = Number(balance.toFixed(2));
      rows.push(row);
    } else {
      // Before the display window — accumulate into the carried-in balance.
      broughtForward = Number(balance.toFixed(2));
    }
  }

  return {
    rows,
    openingStock,
    openingAsOf,
    broughtForward,
    inwardLiters,
    inwardAmount,
    outwardLiters,
    outwardNotFromStockLiters,
    closingBalance: Number(balance.toFixed(2)),
  };
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV in the same column order as the manual DIESEL_REG tab.
export function registerToCsv(result: RegisterResult): string {
  const header = [
    "DATE",
    "TYPE",
    "SUB GROUP",
    "PARTY / VENDOR",
    "MACHINE",
    "ASSET CODE",
    "QTY (L)",
    "SOURCE",
    "RATE",
    "AMOUNT",
    "START READING",
    "END READING",
    "RUNNING BALANCE (L)",
    "REMARKS",
  ];
  const lines = [header.join(",")];
  for (const r of result.rows) {
    const source =
      r.type === "OUTWARD"
        ? r.fuelSource === "shraddha"
          ? "Shraddha pump"
          : r.fuelSource === "outside"
            ? "Offsite (not from site stock)"
            : "Site stock"
        : "";
    lines.push(
      [
        r.date,
        r.type,
        r.subGroup,
        csvEscape(r.party),
        csvEscape(r.machine),
        csvEscape(r.assetCode),
        r.liters.toFixed(2),
        csvEscape(source),
        r.rate != null ? r.rate.toFixed(2) : "",
        r.amount != null ? r.amount.toFixed(2) : "",
        r.meterBroken ? "Reading stop" : r.startReading ?? "",
        r.meterBroken ? "Reading stop" : r.endReading ?? "",
        r.runningBalance.toFixed(2),
        csvEscape(r.note ?? ""),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}
