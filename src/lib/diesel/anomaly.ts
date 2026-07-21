import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyLog, Machine } from "./types";

/* Rule-based anomaly detection on DAILY logs.

   Metric per machine type (only for days with fuel issued AND movement):
     km    → km/L  (distance per liter — higher is better)
     hours → L/hr  (consumption per running hour — lower is better)
   A >30% deviation from the machine's own rolling average raises a flag;
   >60% escalates to high severity.

   There's no separate "meter gap" check: opening is never typed in by a
   human (it's always the machine's carried-forward current_reading), so
   a day's opening always equals the previous reading by construction. A
   machine that ran an unusual distance overnight still surfaces here,
   through the efficiency deviation on that day's numbers.

   Other rules:
     fuel_no_movement fuel issued but the meter didn't move
     over_capacity    more fuel issued than the tank holds
     missing_reading  fuel issued but no closing reading recorded
     declining_trend  a slow multi-week slide a single-day check can't
                       catch — see below */

const DEVIATION_THRESHOLD = 0.3;
const HIGH_DEVIATION = 0.6;
const ROLLING_WINDOW = 7; // prior logged days considered for the day-vs-average check

// A single day's number vs. a 7-day average can miss a slow decline,
// because that same 7-day window drifts down right along with the
// vehicle. So this compares two averages instead: a short RECENT one
// against a longer BASELINE that excludes the recent weeks entirely (so
// it can't be dragged down by the very decline being detected).
const RECENT_WINDOW = 7; // most recent fuel-days
const BASELINE_EXCLUDE_DAYS = 14; // gap between "recent" and "baseline"
const BASELINE_LOOKBACK_DAYS = 90; // how far back the baseline is allowed to reach
const BASELINE_MIN_ENTRIES = 10; // need this many fuel-days for a meaningful baseline
const DECLINE_THRESHOLD = 0.15; // recent trailing baseline by more than this → flagged
const DECLINE_HIGH_THRESHOLD = 0.3;

export interface NewAnomalyFlag {
  log_id: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
}

function dayMetric(machine: Machine, log: DailyLog): number | null {
  if (log.opening_reading == null || log.closing_reading == null) return null;
  const delta = Number(log.closing_reading) - Number(log.opening_reading);
  const fuel = Number(log.fuel_issued_liters);
  if (delta <= 0 || fuel <= 0) return null;
  return machine.reading_type === "hours" ? fuel / delta : delta / fuel;
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function checkDecliningTrend(
  admin: SupabaseClient,
  machine: Machine,
  log: DailyLog,
): Promise<NewAnomalyFlag | null> {
  const unit = machine.reading_type === "hours" ? "L/hr" : "km/L";

  const { data: recentRaw } = await admin
    .from("daily_logs")
    .select("*")
    .eq("machine_id", machine.id)
    .gt("fuel_issued_liters", 0)
    .lte("log_date", log.log_date)
    .order("log_date", { ascending: false })
    .limit(RECENT_WINDOW);

  const baselineStart = shiftDate(log.log_date, -BASELINE_LOOKBACK_DAYS);
  const baselineEnd = shiftDate(log.log_date, -BASELINE_EXCLUDE_DAYS);
  const { data: baselineRaw } = await admin
    .from("daily_logs")
    .select("*")
    .eq("machine_id", machine.id)
    .gt("fuel_issued_liters", 0)
    .gte("log_date", baselineStart)
    .lte("log_date", baselineEnd)
    .order("log_date", { ascending: false })
    .limit(BASELINE_LOOKBACK_DAYS);

  const recentMetrics = ((recentRaw ?? []) as DailyLog[])
    .map((l) => dayMetric(machine, l))
    .filter((v): v is number => v != null);
  const baselineMetrics = ((baselineRaw ?? []) as DailyLog[])
    .map((l) => dayMetric(machine, l))
    .filter((v): v is number => v != null);

  if (recentMetrics.length < 3 || baselineMetrics.length < BASELINE_MIN_ENTRIES) {
    return null; // not enough history either side yet
  }

  const recentAvg = recentMetrics.reduce((s, v) => s + v, 0) / recentMetrics.length;
  const baselineAvg =
    baselineMetrics.reduce((s, v) => s + v, 0) / baselineMetrics.length;
  if (baselineAvg <= 0) return null;

  // "Worse" means opposite things for the two metrics: lower km/L, or
  // higher L/hr. changeRatio is positive whenever recent is worse.
  const changeRatio =
    machine.reading_type === "hours"
      ? (recentAvg - baselineAvg) / baselineAvg
      : (baselineAvg - recentAvg) / baselineAvg;

  if (changeRatio <= DECLINE_THRESHOLD) return null;

  return {
    log_id: log.id,
    type: "declining_trend",
    severity: changeRatio > DECLINE_HIGH_THRESHOLD ? "high" : "medium",
    message: `Last ${recentMetrics.length} fuel days average ${recentAvg.toFixed(2)} ${unit} — ${(changeRatio * 100).toFixed(0)}% worse than this machine's ${baselineMetrics.length}-day baseline of ${baselineAvg.toFixed(2)} ${unit}. Could be a developing mechanical issue.`,
  };
}

export async function computeAnomaliesForLog(
  admin: SupabaseClient,
  machine: Machine,
  log: DailyLog,
): Promise<NewAnomalyFlag[]> {
  const flags: NewAnomalyFlag[] = [];
  const unit = machine.reading_type === "hours" ? "L/hr" : "km/L";
  const fuel = Number(log.fuel_issued_liters);
  const delta =
    log.opening_reading != null && log.closing_reading != null
      ? Number(log.closing_reading) - Number(log.opening_reading)
      : null;

  if (fuel > 0 && delta != null && delta === 0) {
    flags.push({
      log_id: log.id,
      type: "fuel_no_movement",
      severity: "medium",
      message: `${fuel}L issued but the meter did not move that day.`,
    });
  }

  if (fuel > 0 && log.closing_reading == null) {
    flags.push({
      log_id: log.id,
      type: "missing_reading",
      severity: "low",
      message: `${fuel}L issued but no closing reading was recorded.`,
    });
  }

  if (
    machine.tank_capacity_liters != null &&
    fuel > Number(machine.tank_capacity_liters)
  ) {
    flags.push({
      log_id: log.id,
      type: "over_capacity",
      severity: "high",
      message: `${fuel}L issued in one day — more than the machine's ${machine.tank_capacity_liters}L tank capacity.`,
    });
  }

  // Efficiency deviation vs this machine's own recent average — this is
  // also what surfaces an unusually large overnight/off-hours jump.
  const current = dayMetric(machine, log);
  if (current != null) {
    const { data: prior } = await admin
      .from("daily_logs")
      .select("*")
      .eq("machine_id", machine.id)
      .lt("log_date", log.log_date)
      .gt("fuel_issued_liters", 0)
      .order("log_date", { ascending: false })
      .limit(ROLLING_WINDOW);

    const priorMetrics = ((prior ?? []) as DailyLog[])
      .map((l) => dayMetric(machine, l))
      .filter((v): v is number => v != null);

    if (priorMetrics.length > 0) {
      const avg = priorMetrics.reduce((s, v) => s + v, 0) / priorMetrics.length;
      if (avg > 0) {
        const deviation = Math.abs(current - avg) / avg;
        if (deviation > DEVIATION_THRESHOLD) {
          flags.push({
            log_id: log.id,
            type: "efficiency_deviation",
            severity: deviation > HIGH_DEVIATION ? "high" : "medium",
            message: `Today works out to ${current.toFixed(2)} ${unit} — ${(deviation * 100).toFixed(0)}% off this machine's recent average of ${avg.toFixed(2)} ${unit}.`,
          });
        }
      }
    }
  }

  // Slow, sustained decline — a separate check since the one above can't
  // see a drift that its own comparison window is also sliding along with.
  const declineFlag = await checkDecliningTrend(admin, machine, log);
  if (declineFlag) flags.push(declineFlag);

  return flags;
}
