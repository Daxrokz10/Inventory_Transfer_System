import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyLog, Machine } from "./types";
import { computeFillMetrics, type FillMetric } from "./efficiency";

/* Rule-based anomaly detection on DAILY logs.

   Efficiency (km/L or L/hr) is measured per FILL, not per calendar day —
   see efficiency.ts for why: a tank topped up today might run the machine
   for several more days, so blaming all of today's fuel on today's
   movement makes every fill-day look artificially bad. A fill's true
   efficiency only resolves once the NEXT fill happens (that's what bounds
   how far it went), so the efficiency-based checks below evaluate the
   fill that just got CLOSED OUT by today's entry, not today's own
   (still-open) fill — computeAnomaliesForLog runs on every new log, but
   an efficiency flag can land on an EARLIER log's id.

   Other rules (unaffected by any of this — they only ever need today's
   own numbers):
     fuel_no_movement fuel issued but the meter didn't move
     over_capacity    more fuel issued than the tank holds
     missing_reading  fuel issued but no closing reading recorded
     breakdown/maintenance status reported */

const DEVIATION_THRESHOLD = 0.3;
const HIGH_DEVIATION = 0.6;
const ROLLING_WINDOW = 7; // prior closed fills considered for the vs-average check

// A single fill's number vs. a 7-fill average can miss a slow decline,
// because that same window drifts down right along with the vehicle. So
// this compares two averages instead: a short RECENT one against a longer
// BASELINE that excludes the recent weeks entirely (so it can't be
// dragged down by the very decline being detected).
const RECENT_WINDOW = 7; // most recent closed fills
const BASELINE_EXCLUDE_DAYS = 14; // gap between "recent" and "baseline"
const BASELINE_LOOKBACK_DAYS = 90; // how far back the baseline is allowed to reach
const BASELINE_MIN_ENTRIES = 10; // need this many closed fills for a meaningful baseline
const DECLINE_THRESHOLD = 0.15; // recent trailing baseline by more than this → flagged
const DECLINE_HIGH_THRESHOLD = 0.3;

export interface NewAnomalyFlag {
  log_id: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchClosedFillMetrics(
  admin: SupabaseClient,
  machine: Machine,
  uptoDate: string,
  sinceDate: string,
): Promise<FillMetric[]> {
  const { data } = await admin
    .from("daily_logs")
    .select("id, log_date, opening_reading, closing_reading, fuel_issued_liters")
    .eq("machine_id", machine.id)
    .gt("fuel_issued_liters", 0)
    .gte("log_date", sinceDate)
    .lte("log_date", uptoDate)
    .order("log_date", { ascending: true });

  // No currentReading passed — the most recent (still-open) fill in this
  // range is dropped rather than estimated, since it hasn't actually
  // closed yet as far as this query goes.
  return computeFillMetrics(machine, (data ?? []) as DailyLog[]);
}

function checkDecliningTrend(
  machine: Machine,
  closed: FillMetric[],
  justClosed: FillMetric,
): NewAnomalyFlag | null {
  const plausible = closed.filter((m) => m.plausible);
  const recent = plausible.slice(-RECENT_WINDOW);

  const baselineEnd = shiftDate(justClosed.log_date, -BASELINE_EXCLUDE_DAYS);
  const baseline = plausible.filter((m) => m.log_date <= baselineEnd);

  if (recent.length < 3 || baseline.length < BASELINE_MIN_ENTRIES) {
    return null; // not enough history either side yet
  }

  const recentAvg = recent.reduce((s, m) => s + m.value, 0) / recent.length;
  const baselineAvg = baseline.reduce((s, m) => s + m.value, 0) / baseline.length;
  if (baselineAvg <= 0) return null;

  // "Worse" means opposite things for the two metrics: lower km/L, or
  // higher L/hr. changeRatio is positive whenever recent is worse.
  const changeRatio =
    machine.reading_type === "hours"
      ? (recentAvg - baselineAvg) / baselineAvg
      : (baselineAvg - recentAvg) / baselineAvg;

  if (changeRatio <= DECLINE_THRESHOLD) return null;

  const unit = justClosed.unit;
  return {
    log_id: justClosed.log_id,
    type: "declining_trend",
    severity: changeRatio > DECLINE_HIGH_THRESHOLD ? "high" : "medium",
    message: `Last ${recent.length} fills average ${recentAvg.toFixed(2)} ${unit} — ${(changeRatio * 100).toFixed(0)}% worse than this machine's ${baseline.length}-fill baseline of ${baselineAvg.toFixed(2)} ${unit}. Could be a developing mechanical issue.`,
  };
}

export async function computeAnomaliesForLog(
  admin: SupabaseClient,
  machine: Machine,
  log: DailyLog,
): Promise<NewAnomalyFlag[]> {
  const flags: NewAnomalyFlag[] = [];

  // A breakdown/maintenance report is itself worth surfacing to the admin —
  // the machine is down, not just a fuel-data oddity. High severity for a
  // breakdown (unplanned, urgent); medium for planned maintenance.
  if (log.status !== "normal") {
    flags.push({
      log_id: log.id,
      type: log.status,
      severity: log.status === "breakdown" ? "high" : "medium",
      message: `${machine.name} reported ${
        log.status === "breakdown" ? "broken down" : "under maintenance"
      } on ${log.log_date}${log.remarks ? ` — ${log.remarks}` : ""}.`,
    });
  }

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
    // A machine flagged meter-broken can't produce a reading by design —
    // that's expected, not an oversight, but it also means none of the
    // reading-based checks below can run for this fill. Surface it as its
    // own type, at medium severity, so someone actually eyeballs whether
    // the fuel amount is reasonable in place of the automatic cross-check
    // — this will keep recurring every fuel day until the meter is fixed
    // and an admin clears it.
    if (machine.meter_broken) {
      flags.push({
        log_id: log.id,
        type: "meter_broken_unverified",
        severity: "medium",
        message: `${fuel}L issued while this machine's meter is flagged broken — no reading to cross-check against, so review this fill manually.`,
      });
    } else {
      flags.push({
        log_id: log.id,
        type: "missing_reading",
        severity: "low",
        message: `${fuel}L issued but no closing reading was recorded.`,
      });
    }
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

  // Efficiency checks operate on FILLS, not on today's own log — a fill's
  // true efficiency only resolves once the next fill closes it out. If
  // today's entry has fuel, it just closed out whichever fill preceded
  // it; that's what gets judged here (today's own fill stays open/
  // unjudged until whatever comes after it).
  if (fuel > 0) {
    const baselineStart = shiftDate(log.log_date, -BASELINE_LOOKBACK_DAYS);
    const closed = await fetchClosedFillMetrics(admin, machine, log.log_date, baselineStart);
    const justClosed = closed[closed.length - 1];

    if (justClosed) {
      const unit = justClosed.unit;

      // An absolute sanity ceiling/floor, independent of any rolling
      // average — this is what catches a fill with no real prior history
      // to compare against (e.g. the machine's first-ever fill, now
      // closed out by this one) and would otherwise sail through the
      // deviation check below with zero prior data points.
      if (!justClosed.plausible) {
        flags.push({
          log_id: justClosed.log_id,
          type: "implausible_efficiency",
          severity: "high",
          message: `That fill worked out to ${justClosed.value.toFixed(2)} ${unit} (fuel ÷ distance/hours through the next fill), which isn't physically plausible — likely a bad reading somewhere in that stretch. Check the opening/closing readings around ${justClosed.log_date}.`,
        });
      } else {
        // Deviation vs. this machine's own recent (plausible, closed) fills.
        const prior = closed
          .slice(0, -1)
          .filter((m) => m.plausible)
          .slice(-ROLLING_WINDOW);
        if (prior.length > 0) {
          const avg = prior.reduce((s, m) => s + m.value, 0) / prior.length;
          if (avg > 0) {
            const deviation = Math.abs(justClosed.value - avg) / avg;
            if (deviation > DEVIATION_THRESHOLD) {
              flags.push({
                log_id: justClosed.log_id,
                type: "efficiency_deviation",
                severity: deviation > HIGH_DEVIATION ? "high" : "medium",
                message: `That fill worked out to ${justClosed.value.toFixed(2)} ${unit} — ${(deviation * 100).toFixed(0)}% off this machine's recent average of ${avg.toFixed(2)} ${unit}.`,
              });
            }
          }
        }

        // Slow, sustained decline — a separate check since the one above
        // can't see a drift that its own comparison window is also
        // sliding along with.
        const declineFlag = checkDecliningTrend(machine, closed, justClosed);
        if (declineFlag) flags.push(declineFlag);
      }
    }
  }

  return flags;
}
