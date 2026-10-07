import type { Machine } from "./types";

/* Fleet utilization — how hard each machine actually works, where, for how
   long, and whether keeping it is worth the money.

   WHY METER READINGS, NOT LOG COUNT
   A machine only appears in daily_logs when it takes fuel (every 2–4 days
   typically), so "days with an entry" badly understates days worked. Work is
   measured from the meter instead: the hours/km between successive readings.
   Machines with a broken or untracked meter fall back to fuel drawn per day
   as the activity signal.

   THE METHOD, STEP BY STEP
   1. Measurement window — from when the machine was deployed (or its site
      started using the system, whichever is later — a machine isn't idle
      for days nobody was logging anything) to today, or its last activity
      if it has been removed.
   2. Work done — sum of meter advances between consecutive readings, with a
      plausibility gate per day (24 h, or 800 km). A jump past the gate is a
      typo (an extra digit, like 20743.7 keyed as 207443.7) and is skipped,
      so one bad entry can't make a machine look busy or idle.
   3. Peer benchmark — each machine is compared only with others of the same
      type, using the median and the median absolute deviation (MAD) rather
      than mean and standard deviation, so one wildly busy or idle unit
      doesn't distort what "normal" is for the rest.
   4. Utilization % — usage per day against the type's reference: the 75th
      percentile of its peers (what a well-used unit of that type does), or a
      default 8 h/day shift for hour-metered types with too few peers.
   5. Trend — usage over the last 21 days against the period before, to
      catch a machine that is winding down even if its average still looks
      fine.
   6. Dormancy — days since any activity at all.
   7. Money — for hired machines, rent paid per productive hour/km, and the
      share of rent spent on time the machine wasn't working.
   8. Cross-fleet matching — an own machine sitting idle while the same type
      is being rented elsewhere is the cheapest saving available: move it,
      off-hire the rental.

   Every verdict carries plain-language reasons so it can be checked by
   hand. Thresholds are named constants below. */

// ---- Tunable thresholds -------------------------------------------------
/** Below this many measured days a verdict would be guesswork. */
const MIN_DAYS = 14;
/** Plausibility gates: anything faster than this is a typo, not work. */
const MAX_HOURS_PER_DAY = 24;
const MAX_KM_PER_DAY = 800;
/** Default "full use" for hour-metered types with too few peers. */
const DEFAULT_HOURS_PER_DAY = 8;
/** Utilization bands. */
const LOW_UTIL = 35;
const MID_UTIL = 50;
/** Days with no activity at all before a machine counts as dormant. */
const DORMANT_DAYS = 10;
/** No fuel for this long and a hired machine has most likely already gone
    back to its vendor without being removed from the register. */
const GONE_DAYS = 30;
/** Types too varied to benchmark against each other ("Other" mixes cranes,
    pumps and placeholders) — judged on dormancy alone. */
const UNBENCHMARKED_TYPES = new Set(["Other"]);
/** Bookkeeping placeholders, not machines. */
const isPlaceholder = (m: Machine) => /^misc$/i.test(m.name.trim());
/** Trend window, and the drop that counts as "winding down". */
const TREND_DAYS = 21;
const DECLINE_RATIO = 0.6;
const DAYS_PER_MONTH = 30.4;

// ---- Types ---------------------------------------------------------------

export interface UtilLog {
  machine_id: string;
  project_id: string;
  log_date: string;
  opening_reading: number | null;
  closing_reading: number | null;
  fuel_issued_liters: number;
  total_cost: number | null;
}

export type Verdict =
  | "release" // hired, not earning its rent — off-hire it
  | "review" // hired, borderline — check with the site
  | "keep" // working well
  | "redeploy" // own machine, idle or underused — move it where it's needed
  | "underused" // own machine, light use but nowhere obvious to send it
  | "gone" // hired, no fuel for 30+ days — most likely already returned; confirm and remove
  | "insufficient" // too little data to call
  | "untracked" // a fixture with neither fuel nor meter tracked — nothing to measure
  | "removed"; // no longer active — shown for the record

export interface MachineUtil {
  machine: Machine;
  siteId: string;
  unit: "hr" | "km" | "L";
  /** How usage was measured: meter readings, or fuel as a proxy. */
  basis: "meter" | "fuel";
  windowStart: string;
  windowEnd: string;
  daysMeasured: number;
  /** Days with a fuel/reading entry — shown for context, not used as "worked". */
  entryDays: number;
  /** Hours or km run (meter basis) in the window. */
  work: number | null;
  /** Meter advances rejected as typos. */
  glitches: number;
  fuelLiters: number;
  fuelCost: number;
  /** Work per measured day (hr/day, km/day), or L/day on fuel basis. */
  perDay: number | null;
  /** Usage vs the type's reference, 0–100+. */
  utilization: number | null;
  /** Robust z-score within its type (median/MAD). */
  peerZ: number | null;
  /** Rank within its type, 0 = least used, 100 = most. */
  peerPercentile: number | null;
  /** Last-21-days rate ÷ earlier rate; < 0.6 means winding down. */
  trend: number | null;
  daysSinceActive: number;
  /** Hired only. Machine's own rent if entered, else the type rate. */
  monthlyRent: number | null;
  rentSource: "machine" | "type" | null;
  /** Rent paid over the window. */
  rentInWindow: number | null;
  /** Rent + fuel per hour/km actually worked. */
  costPerUnit: number | null;
  /** Rent per month spent on time it wasn't working. */
  idleRentPerMonth: number | null;
  soExpired: boolean;
  verdict: Verdict;
  reasons: string[];
  /** ₹/month this verdict saves if acted on (release / redeploy). */
  monthlySaving: number | null;
}

export interface Redeployment {
  own: MachineUtil;
  rental: MachineUtil;
  sameState: boolean;
  monthlySaving: number | null;
}

export interface TypeSummary {
  machineType: string;
  hired: number;
  own: number;
  unit: "hr" | "km" | "L" | "mixed";
  medianPerDay: number | null;
  reference: number | null;
  avgUtilization: number | null;
  monthlyRent: number;
  unpricedHired: number;
  verdicts: Record<Verdict, number>;
}

export interface FleetUtilization {
  machines: MachineUtil[];
  types: TypeSummary[];
  redeployments: Redeployment[];
  today: string;
}

// ---- Helpers ---------------------------------------------------------------

const DAY_MS = 86_400_000;
const dayNum = (d: string) => Math.floor(new Date(`${d}T00:00:00Z`).getTime() / DAY_MS);
const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Robust z-score: (x − median) / (1.4826 × MAD). 1.4826 scales MAD to match
    a standard deviation under a normal distribution. */
function robustZ(x: number, xs: number[]): number | null {
  const med = median(xs);
  if (med == null || xs.length < 3) return null;
  const mad = median(xs.map((v) => Math.abs(v - med)));
  if (!mad) return null;
  return (x - med) / (1.4826 * mad);
}

function percentileRank(x: number, xs: number[]): number | null {
  if (xs.length < 2) return null;
  const below = xs.filter((v) => v < x).length;
  const equal = xs.filter((v) => v === x).length;
  return Math.round(((below + equal / 2) / xs.length) * 100);
}

/** Meter work between successive readings, with typo rejection. Returns the
    total, the rejected count, and dated work segments for the trend. */
function meterWork(logs: UtilLog[], unit: "hr" | "km") {
  const cap = unit === "hr" ? MAX_HOURS_PER_DAY : MAX_KM_PER_DAY;
  // Each log contributes up to two readings: its opening (carried forward
  // from the previous entry) and its closing (typed that day).
  const points: { date: string; v: number }[] = [];
  for (const l of logs) {
    if (l.opening_reading != null) points.push({ date: l.log_date, v: Number(l.opening_reading) });
    if (l.closing_reading != null) points.push({ date: l.log_date, v: Number(l.closing_reading) });
  }
  let total = 0;
  let glitches = 0;
  const segments: { date: string; work: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].v - points[i - 1].v;
    if (delta <= 0) continue;
    const days = Math.max(1, daysBetween(points[i - 1].date, points[i].date));
    if (delta / days > cap) {
      glitches++;
      continue;
    }
    total += delta;
    segments.push({ date: points[i].date, work: delta });
  }
  return { total, glitches, segments, readings: points.length };
}

// ---- Main ------------------------------------------------------------------

export function analyzeFleet(
  machines: Machine[],
  logs: UtilLog[],
  opts: {
    today: string;
    /** Standard monthly rent per machine type (hired machines). */
    typeRates: Map<string, number>;
    /** project_id → state, for preferring same-state redeployments. */
    siteState: Map<string, string | null>;
  },
): FleetUtilization {
  const { today, typeRates, siteState } = opts;

  const logsByMachine = new Map<string, UtilLog[]>();
  const siteFirstLog = new Map<string, string>();
  for (const l of [...logs].sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0))) {
    (logsByMachine.get(l.machine_id) ?? logsByMachine.set(l.machine_id, []).get(l.machine_id)!).push(l);
    if (!siteFirstLog.has(l.project_id)) siteFirstLog.set(l.project_id, l.log_date);
  }

  // ---- Pass 1: raw measurements per machine
  const rows: MachineUtil[] = [];
  for (const m of machines) {
    if (isPlaceholder(m)) continue;
    const ml = logsByMachine.get(m.id) ?? [];
    const lastLog = ml.at(-1)?.log_date ?? null;
    const deployed = m.deployed_at ?? m.created_at.slice(0, 10);
    // When the site whose login files this machine's entries started using
    // the system — in a shared group that's often a sister site (J-0081
    // files for J-0087), not the machine's own registered site.
    const filingSite = ml[0]?.project_id ?? m.project_id;
    const siteStart = siteFirstLog.get(filingSite) ?? siteFirstLog.get(m.project_id) ?? deployed;
    const windowStart = deployed > siteStart ? deployed : siteStart;
    // A removed machine's window closes at its last activity — there is no
    // deactivation date on record, and it isn't idle after it has left.
    const windowEnd = m.is_active ? today : (lastLog ?? windowStart);
    const daysMeasured = Math.max(1, daysBetween(windowStart, windowEnd) + 1);

    const inWindow = ml.filter((l) => l.log_date >= windowStart && l.log_date <= windowEnd);
    const fuelLiters = inWindow.reduce((s, l) => s + Number(l.fuel_issued_liters || 0), 0);
    const fuelCost = inWindow.reduce((s, l) => s + Number(l.total_cost || 0), 0);
    const entryDays = new Set(inWindow.map((l) => l.log_date)).size;

    const meterUnit: "hr" | "km" = m.reading_type === "hours" ? "hr" : "km";
    const meter = m.track_meter && !m.meter_broken ? meterWork(inWindow, meterUnit) : null;
    const useMeter = !!meter && meter.readings >= 2 && meter.total > 0;

    const basis: "meter" | "fuel" = useMeter ? "meter" : "fuel";
    const unit = useMeter ? meterUnit : "L";
    const work = useMeter ? meter!.total : null;
    const perDay = useMeter ? meter!.total / daysMeasured : fuelLiters > 0 ? fuelLiters / daysMeasured : null;

    // Trend: last TREND_DAYS vs everything before, on the same basis.
    let trend: number | null = null;
    const cut = new Date((dayNum(windowEnd) - TREND_DAYS) * DAY_MS).toISOString().slice(0, 10);
    const earlierDays = daysBetween(windowStart, cut);
    if (earlierDays >= 7) {
      const segs = useMeter
        ? meter!.segments
        : inWindow.map((l) => ({ date: l.log_date, work: Number(l.fuel_issued_liters || 0) }));
      const recent = segs.filter((s) => s.date > cut).reduce((a, s) => a + s.work, 0) / TREND_DAYS;
      const before = segs.filter((s) => s.date <= cut).reduce((a, s) => a + s.work, 0) / earlierDays;
      if (before > 0) trend = recent / before;
    }

    const lastActivity = lastLog ?? windowStart;
    const daysSinceActive = m.is_active ? Math.max(0, daysBetween(lastActivity, today)) : 0;

    let monthlyRent: number | null = null;
    let rentSource: MachineUtil["rentSource"] = null;
    if (m.ownership === "external") {
      if (m.monthly_rent != null) {
        monthlyRent = Number(m.monthly_rent);
        rentSource = "machine";
      } else if (typeRates.has(m.machine_type)) {
        monthlyRent = typeRates.get(m.machine_type)!;
        rentSource = "type";
      }
    }
    const rentInWindow = monthlyRent != null ? (monthlyRent / DAYS_PER_MONTH) * daysMeasured : null;

    rows.push({
      machine: m,
      siteId: m.project_id,
      unit,
      basis,
      windowStart,
      windowEnd,
      daysMeasured,
      entryDays,
      work,
      glitches: meter?.glitches ?? 0,
      fuelLiters,
      fuelCost,
      perDay,
      utilization: null,
      peerZ: null,
      peerPercentile: null,
      trend,
      daysSinceActive,
      monthlyRent,
      rentSource,
      rentInWindow,
      costPerUnit:
        useMeter && work && work > 0 ? ((rentInWindow ?? 0) + fuelCost) / work : null,
      idleRentPerMonth: null,
      soExpired: !!(m.is_active && m.so_until && m.so_until < today),
      verdict: "insufficient",
      reasons: [],
      monthlySaving: null,
    });
  }

  // ---- Pass 2: peer benchmarks, per type AND unit (hours vs km vs fuel
  // aren't comparable even within one type name).
  const peerKey = (r: MachineUtil) => `${r.machine.machine_type}|${r.unit}`;
  const benchmarked = (r: MachineUtil) => !UNBENCHMARKED_TYPES.has(r.machine.machine_type);
  const peers = new Map<string, number[]>();
  for (const r of rows) {
    if (r.perDay == null || r.daysMeasured < MIN_DAYS || !benchmarked(r)) continue;
    (peers.get(peerKey(r)) ?? peers.set(peerKey(r), []).get(peerKey(r))!).push(r.perDay);
  }
  const allKm = rows.filter((r) => r.unit === "km" && r.perDay != null && r.daysMeasured >= MIN_DAYS).map((r) => r.perDay!);
  const reference = (r: MachineUtil): number | null => {
    if (!benchmarked(r)) return null;
    const xs = peers.get(peerKey(r)) ?? [];
    if (xs.length >= 3) return quantile(xs, 0.75);
    if (r.unit === "hr") return DEFAULT_HOURS_PER_DAY;
    if (r.unit === "km") return quantile(allKm, 0.75);
    return null; // fuel basis with too few peers: no fair reference
  };

  for (const r of rows) {
    if (r.perDay == null) continue;
    const xs = peers.get(peerKey(r)) ?? [];
    const ref = reference(r);
    r.utilization = ref ? Math.round((r.perDay / ref) * 100) : null;
    r.peerZ = robustZ(r.perDay, xs);
    r.peerPercentile = percentileRank(r.perDay, xs);
    if (r.monthlyRent != null && r.utilization != null) {
      const idleShare = Math.max(0, 1 - Math.min(r.utilization, 100) / 100);
      r.idleRentPerMonth = Math.round(r.monthlyRent * idleShare);
    }
  }

  // ---- Pass 3: verdicts
  for (const r of rows) {
    const m = r.machine;
    const reasons: string[] = [];
    const unitLabel = r.unit === "L" ? "L of fuel" : r.unit;
    if (r.perDay != null) {
      reasons.push(
        `${r.perDay.toFixed(r.unit === "hr" ? 1 : 0)} ${unitLabel}/day over ${r.daysMeasured} days` +
          (r.utilization != null ? ` — ${r.utilization}% of a well-used ${m.machine_type}` : ""),
      );
    }
    if (r.peerPercentile != null) reasons.push(`busier than ${r.peerPercentile}% of its type`);
    const dormantNow = m.is_active && r.daysSinceActive >= DORMANT_DAYS;
    if (dormantNow) reasons.push(`no fuel or reading for ${r.daysSinceActive} days`);
    // A dormant machine's trend is trivially "down 100%" — say it once.
    if (!dormantNow && r.trend != null && r.trend < DECLINE_RATIO)
      reasons.push(`usage down ${Math.round((1 - r.trend) * 100)}% in the last ${TREND_DAYS} days`);
    if (r.glitches > 0) reasons.push(`${r.glitches} meter typo${r.glitches === 1 ? "" : "s"} ignored`);
    if (r.basis === "fuel" && m.track_meter) reasons.push("meter unusable — judged on fuel drawn");
    if (r.soExpired) reasons.push(`SO ended ${m.so_until}`);

    const dormant = m.is_active && r.daysSinceActive >= DORMANT_DAYS;
    const low = r.utilization != null && r.utilization < LOW_UTIL;
    const mid = r.utilization != null && r.utilization < MID_UTIL;
    const declining = r.trend != null && r.trend < DECLINE_RATIO;
    const enough = r.daysMeasured >= MIN_DAYS && (r.perDay != null || dormant);

    const gone = m.is_active && r.daysSinceActive >= GONE_DAYS;
    if (!m.is_active) {
      r.verdict = "removed";
    } else if (!m.track_fuel && !m.track_meter) {
      r.verdict = "untracked";
      reasons.unshift("fixture — neither fuel nor meter is recorded for it");
    } else if (m.ownership === "external" && gone) {
      r.verdict = "gone";
      r.monthlySaving = r.monthlyRent;
      reasons.unshift("most likely already returned to the vendor — confirm, then remove it so rent stops being counted");
    } else if (!enough) {
      r.verdict = "insufficient";
      reasons.unshift(`only ${r.daysMeasured} days of data`);
    } else if (m.ownership === "external") {
      if (dormant || low) {
        r.verdict = "release";
        r.monthlySaving = r.monthlyRent;
      } else if (mid || declining || r.soExpired) {
        r.verdict = "review";
      } else {
        r.verdict = "keep";
      }
    } else {
      r.verdict = dormant || low ? "underused" : "keep";
    }
    if (!benchmarked(r) && m.is_active && r.verdict !== "untracked")
      reasons.push(`"${m.machine_type}" mixes unlike machines, so judged on activity only`);
    r.reasons = reasons;
  }

  // ---- Pass 4: cross-fleet matching. Each idle/underused OWN machine is
  // paired with the worst-performing active RENTAL of the same type —
  // preferring same-state (cheap to move), then the costliest rent.
  const takenRentals = new Set<string>();
  const redeployments: Redeployment[] = [];
  const ownIdle = rows
    .filter(
      (r) =>
        r.machine.ownership === "internal" &&
        r.verdict === "underused" &&
        !UNBENCHMARKED_TYPES.has(r.machine.machine_type),
    )
    .sort((a, b) => (a.utilization ?? -1) - (b.utilization ?? -1));
  for (const own of ownIdle) {
    const state = siteState.get(own.siteId) ?? null;
    const options = rows.filter(
      (r) =>
        r.machine.ownership === "external" &&
        r.machine.is_active &&
        r.machine.machine_type === own.machine.machine_type &&
        !takenRentals.has(r.machine.id) &&
        r.siteId !== own.siteId,
    );
    if (options.length === 0) continue;
    options.sort((a, b) => {
      const sa = state && siteState.get(a.siteId) === state ? 0 : 1;
      const sb = state && siteState.get(b.siteId) === state ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (b.monthlyRent ?? 0) - (a.monthlyRent ?? 0);
    });
    const rental = options[0];
    takenRentals.add(rental.machine.id);
    own.verdict = "redeploy";
    own.monthlySaving = rental.monthlyRent;
    own.reasons.push(`same type is being rented at another site — move this one, off-hire that`);
    redeployments.push({
      own,
      rental,
      sameState: !!state && siteState.get(rental.siteId) === state,
      monthlySaving: rental.monthlyRent,
    });
  }

  // ---- Type summaries
  const typeMap = new Map<string, MachineUtil[]>();
  for (const r of rows) {
    if (!r.machine.is_active) continue;
    (typeMap.get(r.machine.machine_type) ?? typeMap.set(r.machine.machine_type, []).get(r.machine.machine_type)!).push(r);
  }
  const emptyVerdicts = (): Record<Verdict, number> => ({
    release: 0,
    review: 0,
    keep: 0,
    redeploy: 0,
    underused: 0,
    gone: 0,
    insufficient: 0,
    untracked: 0,
    removed: 0,
  });
  const types: TypeSummary[] = [...typeMap.entries()].map(([machineType, rs]) => {
    const units = new Set(rs.map((r) => r.unit));
    const unit = units.size === 1 ? [...units][0] : "mixed";
    const perDays = rs.filter((r) => r.perDay != null && r.daysMeasured >= MIN_DAYS).map((r) => r.perDay!);
    const utils = rs.filter((r) => r.utilization != null).map((r) => r.utilization!);
    const verdicts = emptyVerdicts();
    rs.forEach((r) => verdicts[r.verdict]++);
    const hired = rs.filter((r) => r.machine.ownership === "external");
    return {
      machineType,
      hired: hired.length,
      own: rs.length - hired.length,
      unit,
      medianPerDay: unit === "mixed" ? null : median(perDays),
      reference: unit === "mixed" || !rs[0] ? null : reference(rs[0]),
      avgUtilization: utils.length ? Math.round(utils.reduce((a, b) => a + b, 0) / utils.length) : null,
      monthlyRent: hired.reduce((s, r) => s + (r.monthlyRent ?? 0), 0),
      unpricedHired: hired.filter((r) => r.monthlyRent == null).length,
      verdicts,
    };
  });
  types.sort((a, b) => b.hired + b.own - (a.hired + a.own));

  return { machines: rows, types, redeployments, today };
}
