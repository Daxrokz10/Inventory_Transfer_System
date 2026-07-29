import type { DailyLog, Machine } from "./types";

/* A day's efficiency — km/L for odometer-tracked machines, L/hr for
   hour-meter ones. An implausible result (an astronomical km/L, or an
   L/hr near zero) almost always means "opening" wasn't really the
   previous day's close — the classic case is a machine's very first-ever
   entry, where opening is just whatever was typed in at registration and
   closing reflects its entire life-to-date distance, compressed into one
   day's fuel. There's no way to recover a true daily figure from that,
   so it's excluded from display and from every rolling average, rather
   than shown or averaged as if it were real. */

export const MAX_KM_PER_L = 50;
export const MIN_L_PER_HR = 1;

type MetricInput = Pick<Machine, "reading_type">;
type LogInput = Pick<DailyLog, "opening_reading" | "closing_reading" | "fuel_issued_liters">;

export interface DayMetric {
  value: number;
  unit: "km/L" | "L/hr";
  plausible: boolean;
}

export function computeDayMetric(machine: MetricInput, log: LogInput): DayMetric | null {
  if (log.opening_reading == null || log.closing_reading == null) return null;
  const delta = Number(log.closing_reading) - Number(log.opening_reading);
  const fuel = Number(log.fuel_issued_liters);
  if (delta <= 0 || fuel <= 0) return null;

  const isHours = machine.reading_type === "hours";
  const value = isHours ? fuel / delta : delta / fuel;
  const unit: "km/L" | "L/hr" = isHours ? "L/hr" : "km/L";
  const plausible = isHours ? value >= MIN_L_PER_HR : value <= MAX_KM_PER_L;
  return { value, unit, plausible };
}

/** The plausibility-filtered value — null for both "can't compute" and
    "computed but not believable". What every display/averaging call site
    should use. */
export function dayMetric(machine: MetricInput, log: LogInput): number | null {
  const m = computeDayMetric(machine, log);
  return m && m.plausible ? m.value : null;
}
