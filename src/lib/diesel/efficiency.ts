import type { DailyLog, Machine } from "./types";

export const MAX_KM_PER_L = 50;
export const MIN_L_PER_HR = 1;

type MetricInput = Pick<Machine, "reading_type">;
type FillLogInput = Pick<
  DailyLog,
  "id" | "log_date" | "opening_reading" | "closing_reading" | "fuel_issued_liters"
>;

export interface FillMetric {
  log_id: string;
  log_date: string;
  value: number;
  unit: "km/L" | "L/hr";
  plausible: boolean;
  /** True only for the most recent fill, when there's no later fill yet
      to close out how far it actually went — an estimate using the
      machine's current reading, which will firm up (and may change) once
      the next fill happens. */
  provisional: boolean;
}

/**
 * Attributes each fill's fuel to the FULL distance/hours it actually
 * covered — from the reading AT the fill (the trip that was just
 * finished is already done, on whatever fuel was in the tank before)
 * through the reading right before the NEXT fill — instead of just
 * that single calendar day's movement.
 *
 * Fuel is dispensed after that day's trip is already complete, so it
 * doesn't power the movement it's logged alongside — it powers whatever
 * comes next, until the tank is topped up again. Pairing each fill with
 * the span from its OWN closing reading through the next fill's closing
 * reading captures that: readings are a running total, so "next fill's
 * closing reading" already equals "whatever the reading was right
 * before that fill," across however many (or few) days sit in between.
 *
 * `logs` only needs to contain this machine's fuel-days
 * (fuel_issued_liters > 0) — order doesn't matter, this sorts them.
 * Pass `currentReading` (the machine's live current_reading) to also get
 * a provisional estimate for the most recent, still-open fill — e.g. for
 * display. Omit it to get only fully-resolved (closed) fills — e.g. for
 * anomaly checks, which shouldn't judge a fill before it's actually done.
 */
export function computeFillMetrics(
  machine: MetricInput,
  logs: FillLogInput[],
  currentReading?: number | null,
): FillMetric[] {
  const fillDays = logs
    .filter((l) => Number(l.fuel_issued_liters) > 0 && l.closing_reading != null)
    .sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));

  const isHours = machine.reading_type === "hours";
  const results: FillMetric[] = [];

  for (let i = 0; i < fillDays.length; i++) {
    const fill = fillDays[i];
    const next = fillDays[i + 1];
    const endReading = next ? next.closing_reading : (currentReading ?? null);
    if (endReading == null) continue;

    const distance = Number(endReading) - Number(fill.closing_reading);
    const fuel = Number(fill.fuel_issued_liters);
    if (distance <= 0 || fuel <= 0) continue;

    const value = isHours ? fuel / distance : distance / fuel;
    const unit: "km/L" | "L/hr" = isHours ? "L/hr" : "km/L";
    const plausible = isHours ? value >= MIN_L_PER_HR : value <= MAX_KM_PER_L;
    results.push({
      log_id: fill.id,
      log_date: fill.log_date,
      value,
      unit,
      plausible,
      provisional: !next,
    });
  }

  return results;
}
