"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeAnomaliesForLog } from "@/lib/diesel/anomaly";
import { getPricesForCity } from "@/lib/diesel/fuelPrice";
import { cityForState } from "@/lib/diesel/types";
import type { DailyLog, Machine } from "@/lib/diesel/types";

interface SheetRow {
  machine_id: string;
  closing_reading: number | null;
  fuel_issued_liters: number;
  remarks: string | null;
  /** "breakdown"/"maintenance" days skip the reading/fuel requirement —
      the machine simply wasn't in normal use. */
  status: "normal" | "breakdown" | "maintenance";
}

// Save the daily sheet for one or more machines. Exactly one report per
// machine per day: a machine that already has a log for this date is
// skipped entirely (locked) — resubmitting isn't allowed, whether that's
// today or any past day. Tomorrow is a fresh, unlocked day as normal,
// carrying forward from whatever was saved today.
// Shaped for useActionState: returns an error string, or null on success.
export async function saveDailySheet(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const log_date = String(formData.get("log_date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(log_date)) return "Pick a valid date.";
  if (log_date > new Date().toISOString().slice(0, 10)) {
    return "The report date cannot be in the future.";
  }

  let rows: SheetRow[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return "Could not read the sheet rows.";
  }

  // Only persist rows that actually say something — a breakdown/
  // maintenance status counts on its own, without a reading or fuel.
  rows = rows.filter(
    (r) =>
      r.machine_id &&
      (r.fuel_issued_liters > 0 ||
        r.closing_reading != null ||
        (r.remarks ?? "").trim() !== "" ||
        r.status !== "normal"),
  );
  if (rows.length === 0) {
    return "Nothing to save — fill in at least one machine.";
  }

  // Machines are RLS-scoped, so a supervisor only ever resolves their own
  // site's machines here.
  const { data: machinesRaw } = await supabase
    .from("machines")
    .select("*")
    .in("id", rows.map((r) => r.machine_id));
  const machines = (machinesRaw ?? []) as Machine[];
  const machineById = new Map(machines.map((m) => [m.id, m]));
  if (machines.length !== rows.length) {
    return "One of the machines could not be found at your site.";
  }
  const projectId = machines[0].project_id;
  if (machines.some((m) => m.project_id !== projectId)) {
    return "All machines on one sheet must belong to the same site.";
  }
  if (machines.some((m) => !m.track_fuel)) {
    return "One of these machines isn't set up for fuel tracking.";
  }

  const admin = createAdminClient();

  // Machines already reported for this date are locked — drop them
  // rather than touch an existing row. Whatever's left (if anything) is
  // this submission's genuinely new entries.
  const { data: existingRaw } = await admin
    .from("daily_logs")
    .select("machine_id")
    .eq("log_date", log_date)
    .in("machine_id", rows.map((r) => r.machine_id));
  const alreadyReported = new Set(
    ((existingRaw ?? []) as Pick<DailyLog, "machine_id">[]).map((l) => l.machine_id),
  );
  rows = rows.filter((r) => !alreadyReported.has(r.machine_id));
  if (rows.length === 0) {
    return "Every machine here has already been reported for this date — one report per machine per day.";
  }

  // The reading can only ever go forward from the machine's last known value.
  for (const r of rows) {
    const m = machineById.get(r.machine_id)!;
    if (
      r.closing_reading != null &&
      m.current_reading != null &&
      r.closing_reading < m.current_reading
    ) {
      return `${m.name}: reading (${r.closing_reading}) can't be behind the last recorded reading (${m.current_reading}).`;
    }
  }

  // Day's fuel prices for this site's state (resolved to a reference
  // city, cache → scrape → stale).
  const { data: project } = await admin
    .from("projects")
    .select("state")
    .eq("id", projectId)
    .single();
  const prices = await getPricesForCity(cityForState(project?.state ?? null), log_date);

  const inserts = rows.map((r) => {
    const m = machineById.get(r.machine_id)!;
    const rate = m.fuel_type === "petrol" ? prices.petrol : prices.diesel;
    const fuel_issued_liters = Number(r.fuel_issued_liters) || 0;

    return {
      machine_id: r.machine_id,
      project_id: projectId,
      log_date,
      // Opening is never typed in — it's the reading as it stood before
      // this entry (the machine's carried-forward value).
      opening_reading: m.current_reading,
      closing_reading: r.closing_reading,
      fuel_issued_liters,
      rate_per_liter: fuel_issued_liters > 0 ? rate : null,
      total_cost:
        fuel_issued_liters > 0 && rate != null
          ? Number((rate * fuel_issued_liters).toFixed(2))
          : null,
      remarks: (r.remarks ?? "").trim() || null,
      status: r.status,
      entered_by: user.id,
    };
  });

  const { data: saved, error } = await supabase
    .from("daily_logs")
    .insert(inserts)
    .select("*");
  if (error) {
    if (error.code === "23505") {
      return "That machine was just reported by someone else for this date — refresh and try again.";
    }
    return error.message;
  }

  // Keep each machine's persistent current reading in sync.
  for (const log of (saved ?? []) as DailyLog[]) {
    if (log.closing_reading == null) continue;
    await admin
      .from("machines")
      .update({
        current_reading: log.closing_reading,
        current_reading_at: new Date().toISOString(),
      })
      .eq("id", log.machine_id);
  }

  // Anomaly checks for the newly saved logs. Failures here must not
  // block the save.
  try {
    for (const log of (saved ?? []) as DailyLog[]) {
      const machine = machineById.get(log.machine_id);
      if (!machine) continue;
      const flags = await computeAnomaliesForLog(admin, machine, log);
      if (flags.length > 0) await admin.from("anomaly_flags").insert(flags);
    }
  } catch (err) {
    console.error("Anomaly check failed for sheet", log_date, err);
  }

  revalidatePath("/diesel");
  return null;
}

// Admin-only by RLS: mark an anomaly flag as resolved.
export async function resolveFlag(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = String(formData.get("flag_id") ?? "");
  if (!id) return;

  await supabase.from("anomaly_flags").update({ resolved: true }).eq("id", id);
  revalidatePath("/diesel");
  revalidatePath("/diesel/anomalies");
}
