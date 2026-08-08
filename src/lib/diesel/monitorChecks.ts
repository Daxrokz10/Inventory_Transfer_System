import type { SupabaseClient } from "@supabase/supabase-js";

/* The daily review's checks.

   Deliberately contains NO LLM code. Every finding below is derived by a
   rule and arrives with its own written message, so a review that runs while
   the model's host PC is asleep still produces complete, useful rows — the
   model's only later contribution is rephrasing. This split is the whole
   point: the valuable half of the feature must not depend on the fragile
   half.

   These are cross-site management findings, spanning many logs — which is
   why they don't go through anomaly.ts (one flag, one daily_logs row) and
   land in diesel_ai_insights instead.

   Callers pass a SERVICE-ROLE client: the review reasons about every site at
   once, which no single user's RLS scope permits. */

export interface InsightFact {
  project_id: string | null;
  category: string;
  severity: "low" | "medium" | "high";
  /** Rule-written, always present. */
  message: string;
  raw_facts: Record<string, unknown>;
}

/** Balance at or below this is worth surfacing even when still positive. */
const LOW_BALANCE_LITERS = 50;
/** Unresolved flags of the same type on the same machine within the window. */
const RECURRING_WINDOW_DAYS = 14;
const RECURRING_MIN_COUNT = 3;
/** A hired machine with no fuel logged in this long is likely sitting idle. */
const IDLE_DAYS = 14;
/** ...but a machine that only arrived recently is judged over its time on
    site instead, provided that's at least this long. Without this, the guard
    against flagging fresh arrivals would also permanently exempt any machine
    transferred more often than IDLE_DAYS — deployed_at resets on transfer. */
const IDLE_MIN_OBSERVATION_DAYS = 7;
/** Barrel spend compared over these windows. */
const SPEND_RECENT_DAYS = 30;
const SPEND_BASELINE_DAYS = 90;
const SPEND_SPIKE_RATIO = 1.6;
/** Below this, a "spike" is just noise on a small base. */
const SPEND_MATERIAL_INR = 20_000;

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const num = (n: number, dp = 1) =>
  n.toLocaleString("en-IN", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

/** PostgREST caps a single response (1000 rows by default), which several of
    these checks would silently exceed — a truncated read here would mean a
    machine looking idle purely because its log fell off the end. Pages until
    a short page comes back. */
/* The builder's data is taken as `unknown` and asserted to T by the caller,
   because supabase-js types an embedded join (`daily_logs!inner(...)`) as an
   array while PostgREST returns a single object for a to-one relationship —
   the same mismatch anomalies/page.tsx casts around. */
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize = 1000,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  console.warn("Monitor: hit page cap, results may be partial");
  return out;
}

export async function runMonitorChecks(
  admin: SupabaseClient,
  today: string,
): Promise<InsightFact[]> {
  const { data: projectsRaw } = await admin
    .from("projects")
    .select("id, name, code, is_active");
  const siteLabel = new Map<string, string>();
  const activeSites = new Set<string>();
  for (const p of (projectsRaw ?? []) as {
    id: string;
    name: string;
    code: string | null;
    is_active: boolean;
  }[]) {
    siteLabel.set(p.id, p.code ? `${p.code} · ${p.name}` : p.name);
    if (p.is_active) activeSites.add(p.id);
  }
  const label = (id: string) => siteLabel.get(id) ?? "an unknown site";

  // Each check is independent — one failing (a missing view, a changed
  // column) must not cost the others their findings.
  const results = await Promise.allSettled([
    checkBalances(admin, activeSites, label),
    checkRecurringAnomalies(admin, today, label),
    checkIdleHiredMachines(admin, today, activeSites, label),
    checkSpendSpikes(admin, today, activeSites, label),
  ]);

  const facts: InsightFact[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") facts.push(...r.value);
    else console.error("Monitor check failed", r.reason);
  }
  return facts;
}

/* ---------- 1. Barrel stock balance ---------------------------------------
   Reads the diesel_site_balances view (migration 0030), which mirrors
   buildDieselRegister's math in one query — the app-side helper walks a
   single site's whole history, so calling it per site would be 100+ full
   history scans per run. */
async function checkBalances(
  admin: SupabaseClient,
  activeSites: Set<string>,
  label: (id: string) => string,
): Promise<InsightFact[]> {
  const { data, error } = await admin
    .from("diesel_site_balances")
    .select(
      "project_id, opening_stock, received_liters, issued_from_stock_liters, closing_balance, last_issue_date",
    );
  if (error) throw error;

  const facts: InsightFact[] = [];
  for (const row of (data ?? []) as {
    project_id: string;
    opening_stock: number | null;
    received_liters: number | null;
    issued_from_stock_liters: number | null;
    closing_balance: number | null;
    last_issue_date: string | null;
  }[]) {
    if (!activeSites.has(row.project_id)) continue;
    const balance = Number(row.closing_balance ?? 0);
    const issued = Number(row.issued_from_stock_liters ?? 0);

    // A site that has never issued from its own stock has a meaningless
    // balance, not a problem — plenty of sites only ever fill outside.
    if (issued <= 0) continue;
    if (balance > LOW_BALANCE_LITERS) continue;

    const rawFacts = {
      opening_stock: Number(row.opening_stock ?? 0),
      received_liters: Number(row.received_liters ?? 0),
      issued_from_stock_liters: issued,
      closing_balance: balance,
      last_issue_date: row.last_issue_date,
    };

    if (balance < 0) {
      facts.push({
        project_id: row.project_id,
        category: "negative_balance",
        severity: "high",
        message: `${label(row.project_id)}: barrel stock shows ${num(balance)} L — more diesel has been issued than the recorded deliveries can account for (${num(rawFacts.received_liters)} L received against ${num(issued)} L issued, opening count ${num(rawFacts.opening_stock)} L). Either a delivery hasn't been entered, or the opening count needs re-anchoring against a physical count.`,
        raw_facts: rawFacts,
      });
    } else {
      facts.push({
        project_id: row.project_id,
        category: "low_balance",
        severity: "medium",
        message: `${label(row.project_id)}: only ${num(balance)} L of barrel stock left on the books. Worth confirming a delivery is on the way before the site runs dry.`,
        raw_facts: rawFacts,
      });
    }
  }
  return facts;
}

/* ---------- 2. Recurring unresolved anomalies ----------------------------
   A single flag is the Anomaly Review page's business. The same flag type
   landing on the same machine repeatedly, with nobody resolving it, is a
   different signal — either a real developing fault or a habit at that site. */
async function checkRecurringAnomalies(
  admin: SupabaseClient,
  today: string,
  label: (id: string) => string,
): Promise<InsightFact[]> {
  const since = shiftDate(today, -RECURRING_WINDOW_DAYS);

  const flags = await fetchAllRows<{
    type: string;
    severity: string;
    daily_logs: { machine_id: string; project_id: string; log_date: string } | null;
  }>((from, to) =>
    admin
      .from("anomaly_flags")
      .select("type, severity, daily_logs!inner(machine_id, project_id, log_date)")
      .eq("resolved", false)
      .gte("daily_logs.log_date", since)
      .lte("daily_logs.log_date", today)
      .range(from, to),
  );

  // machine + flag type → occurrences
  const grouped = new Map<
    string,
    { machineId: string; projectId: string; type: string; count: number; worst: string }
  >();
  for (const f of flags) {
    const log = f.daily_logs;
    if (!log) continue;
    const key = `${log.machine_id}|${f.type}`;
    const cur =
      grouped.get(key) ??
      {
        machineId: log.machine_id,
        projectId: log.project_id,
        type: f.type,
        count: 0,
        worst: "low",
      };
    cur.count += 1;
    if (f.severity === "high" || (f.severity === "medium" && cur.worst === "low")) {
      cur.worst = f.severity;
    }
    grouped.set(key, cur);
  }

  const repeated = [...grouped.values()].filter((g) => g.count >= RECURRING_MIN_COUNT);
  if (repeated.length === 0) return [];

  const { data: machinesRaw } = await admin
    .from("machines")
    .select("id, name, registration_no")
    .in("id", [...new Set(repeated.map((g) => g.machineId))]);
  const machineName = new Map(
    (machinesRaw ?? []).map((m) => [
      m.id as string,
      m.registration_no ? `${m.name} (${m.registration_no})` : (m.name as string),
    ]),
  );

  // One insight per site, since the unique constraint is per site+category —
  // and an admin reads this as "these machines at this site", not as N rows.
  const bySite = new Map<string, typeof repeated>();
  for (const g of repeated) {
    (bySite.get(g.projectId) ?? bySite.set(g.projectId, []).get(g.projectId)!).push(g);
  }

  return [...bySite.entries()].map(([projectId, groups]) => {
    const worst = groups.some((g) => g.worst === "high") ? "high" : "medium";
    const detail = groups
      .map(
        (g) =>
          `${machineName.get(g.machineId) ?? "a machine"} — ${g.type} ×${g.count}`,
      )
      .join("; ");
    return {
      project_id: projectId,
      category: "recurring_anomaly",
      severity: worst as "high" | "medium",
      message: `${label(projectId)}: the same anomaly keeps recurring unresolved over the last ${RECURRING_WINDOW_DAYS} days — ${detail}. A repeat pattern usually means a developing fault or a habit at the site, not a one-off entry error.`,
      raw_facts: {
        window_days: RECURRING_WINDOW_DAYS,
        since,
        groups: groups.map((g) => ({
          machine_id: g.machineId,
          type: g.type,
          count: g.count,
        })),
      },
    };
  });
}

/* ---------- 3. Idle hired machines ---------------------------------------
   Rent accrues whether or not the machine turns a wheel, so a hired unit
   with no fuel drawn in two weeks is money leaving for nothing. Priced where
   monthly_rent is known. */
async function checkIdleHiredMachines(
  admin: SupabaseClient,
  today: string,
  activeSites: Set<string>,
  label: (id: string) => string,
): Promise<InsightFact[]> {
  const cutoff = shiftDate(today, -IDLE_DAYS);

  const { data: machinesRaw, error } = await admin
    .from("machines")
    .select("id, name, registration_no, project_id, monthly_rent, deployed_at, vendor_name")
    .eq("ownership", "external")
    .eq("is_active", true)
    .eq("track_fuel", true);
  if (error) throw error;

  const candidates = ((machinesRaw ?? []) as {
    id: string;
    name: string;
    registration_no: string | null;
    project_id: string;
    monthly_rent: number | null;
    deployed_at: string | null;
    vendor_name: string | null;
  }[]).filter((m) => activeSites.has(m.project_id));

  // Each machine is judged over its OWN window: the last IDLE_DAYS, or its
  // time on site if it arrived more recently than that. Too short a window
  // proves nothing, so those machines are simply skipped this run.
  const minObserved = shiftDate(today, -IDLE_MIN_OBSERVATION_DAYS);
  const observed = candidates
    .map((m) => ({
      machine: m,
      windowStart:
        m.deployed_at && m.deployed_at > cutoff ? m.deployed_at : cutoff,
    }))
    .filter((c) => c.windowStart <= minObserved);
  if (observed.length === 0) return [];

  const ids = observed.map((c) => c.machine.id);
  const recent = await fetchAllRows<{ machine_id: string; log_date: string }>(
    (from, to) =>
      admin
        .from("daily_logs")
        .select("machine_id, log_date")
        .in("machine_id", ids)
        // One query covering the widest window, then filtered per machine
        // below against its own start date.
        .gte("log_date", cutoff)
        .lte("log_date", today)
        .gt("fuel_issued_liters", 0)
        .range(from, to),
  );
  const lastFuelled = new Map<string, string>();
  for (const r of recent) {
    const prev = lastFuelled.get(r.machine_id);
    if (!prev || r.log_date > prev) lastFuelled.set(r.machine_id, r.log_date);
  }

  const idle = observed
    .filter((c) => {
      const last = lastFuelled.get(c.machine.id);
      return !last || last < c.windowStart;
    })
    .map((c) => ({ ...c.machine, windowStart: c.windowStart }));
  if (idle.length === 0) return [];

  const bySite = new Map<string, typeof idle>();
  for (const m of idle) {
    (bySite.get(m.project_id) ?? bySite.set(m.project_id, []).get(m.project_id)!).push(m);
  }

  const daysSince = (from: string) =>
    Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    );

  return [...bySite.entries()].map(([projectId, machines]) => {
    const pricedRent = machines.reduce((s, m) => s + Number(m.monthly_rent ?? 0), 0);
    // Rent is monthly, so pro-rate over the longest idle stretch at this site
    // to say something honest about what it cost.
    const maxIdleDays = Math.max(...machines.map((m) => daysSince(m.windowStart)));
    const idleCost = (pricedRent * maxIdleDays) / 30;
    const names = machines
      .map(
        (m) =>
          `${m.registration_no ? `${m.name} (${m.registration_no})` : m.name} — ${daysSince(m.windowStart)}d`,
      )
      .join(", ");
    return {
      project_id: projectId,
      category: "idle_hired_machine",
      severity: pricedRent > 0 ? "medium" : "low",
      message: `${label(projectId)}: ${machines.length} hired machine${machines.length === 1 ? "" : "s"} drew no fuel across the period shown — ${names}.${
        pricedRent > 0
          ? ` At the recorded rents that's roughly INR ${num(idleCost, 0)} for the idle stretch.`
          : " No monthly rent is recorded against them, so the cost of the idle time can't be put in figures."
      } Either they're genuinely standing by, or the daily report isn't being filed for them.`,
      raw_facts: {
        max_idle_days: maxIdleDays,
        window_cap_days: IDLE_DAYS,
        machines: machines.map((m) => ({
          machine_id: m.id,
          name: m.name,
          registration_no: m.registration_no,
          vendor_name: m.vendor_name,
          monthly_rent: m.monthly_rent,
          // Per machine, since a recent arrival is judged over a shorter
          // window than one that's been on site all fortnight.
          idle_since: m.windowStart,
          idle_days: daysSince(m.windowStart),
        })),
        priced_monthly_rent_total: pricedRent,
        estimated_idle_cost: Number(idleCost.toFixed(2)),
      },
    };
  });
}

/* ---------- 4. Barrel spend spikes --------------------------------------
   Compared on fuel_receipts (procurement) rather than daily_logs: money
   moves in lumps when barrels are bought, and it's a far smaller table to
   compare windows across. */
async function checkSpendSpikes(
  admin: SupabaseClient,
  today: string,
  activeSites: Set<string>,
  label: (id: string) => string,
): Promise<InsightFact[]> {
  const recentFrom = shiftDate(today, -SPEND_RECENT_DAYS);
  const baselineFrom = shiftDate(today, -(SPEND_RECENT_DAYS + SPEND_BASELINE_DAYS));

  const receipts = await fetchAllRows<{
    project_id: string;
    receipt_date: string;
    liters: number;
    total_cost: number | null;
    vendor: string | null;
  }>((from, to) =>
    admin
      .from("fuel_receipts")
      .select("project_id, receipt_date, liters, total_cost, vendor")
      .eq("fuel_type", "diesel")
      .gte("receipt_date", baselineFrom)
      .lte("receipt_date", today)
      .range(from, to),
  );

  type Window = { cost: number; liters: number; vendors: Map<string, number> };
  const agg = new Map<string, { recent: Window; baseline: Window }>();
  const blank = (): Window => ({ cost: 0, liters: 0, vendors: new Map() });

  for (const r of receipts) {
    if (!activeSites.has(r.project_id)) continue;
    const cur =
      agg.get(r.project_id) ?? { recent: blank(), baseline: blank() };
    const w = r.receipt_date >= recentFrom ? cur.recent : cur.baseline;
    w.cost += Number(r.total_cost ?? 0);
    w.liters += Number(r.liters);
    if (r.vendor) w.vendors.set(r.vendor, (w.vendors.get(r.vendor) ?? 0) + Number(r.total_cost ?? 0));
    agg.set(r.project_id, cur);
  }

  const facts: InsightFact[] = [];
  for (const [projectId, w] of agg) {
    if (w.recent.cost < SPEND_MATERIAL_INR) continue;
    // Baseline normalised to the same window length, so the comparison is
    // like-for-like rather than 30 days against 90.
    const baselineRate =
      (w.baseline.cost / SPEND_BASELINE_DAYS) * SPEND_RECENT_DAYS;
    // No baseline at all isn't a spike — it's a site that only just started
    // buying, and saying "up ∞%" would be noise.
    if (baselineRate <= 0) continue;
    const ratio = w.recent.cost / baselineRate;
    if (ratio < SPEND_SPIKE_RATIO) continue;

    const topVendor = [...w.recent.vendors.entries()].sort((a, b) => b[1] - a[1])[0];
    facts.push({
      project_id: projectId,
      category: "spend_spike",
      severity: ratio >= SPEND_SPIKE_RATIO * 1.5 ? "high" : "medium",
      message: `${label(projectId)}: diesel purchased in the last ${SPEND_RECENT_DAYS} days cost INR ${num(w.recent.cost, 0)} (${num(w.recent.liters)} L) — about ${num(ratio, 1)}× the INR ${num(baselineRate, 0)} the previous ${SPEND_BASELINE_DAYS} days would suggest for a window this long.${
        topVendor ? ` Most of it from ${topVendor[0]}.` : ""
      } Could be genuine ramp-up in work, or barrels being booked faster than they're used.`,
      raw_facts: {
        recent_days: SPEND_RECENT_DAYS,
        baseline_days: SPEND_BASELINE_DAYS,
        recent_cost: Number(w.recent.cost.toFixed(2)),
        recent_liters: Number(w.recent.liters.toFixed(2)),
        baseline_normalised_cost: Number(baselineRate.toFixed(2)),
        ratio: Number(ratio.toFixed(2)),
        top_vendor: topVendor ? topVendor[0] : null,
      },
    });
  }
  return facts;
}
