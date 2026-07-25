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
  /** Where fuel was filled — "outside" if the vehicle went to a pump not
      tied to the site's own stock; otherwise the site's normal source
      (on_site, or shraddha at the two Shraddha-pump sites). */
  fuel_source?: "on_site" | "shraddha" | "outside" | null;
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
  if (machines.some((m) => !m.track_meter && !m.track_fuel)) {
    return "One of these machines isn't set up for the daily report.";
  }
  // A machine with fuel tracking off must not carry fuel through — it may
  // still be here purely for its reading (e.g. a batching plant's hours).
  for (const r of rows) {
    const m = machineById.get(r.machine_id)!;
    if (!m.track_fuel && r.fuel_issued_liters > 0) {
      return `${m.name} isn't set up for fuel tracking.`;
    }
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
    .select("state, shraddha_pump")
    .eq("id", projectId)
    .single();
  const prices = await getPricesForCity(cityForState(project?.state ?? null), log_date);
  // Source is only meaningful at Shraddha-pump sites — enforce server-side
  // so a stale/forged client can't stamp a source on a non-Shraddha site.
  const isShraddhaPump = project?.shraddha_pump === true;

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
      // Source only applies with fuel. Every site defaults to its normal
      // source (on_site everywhere, shraddha at the two Shraddha-pump
      // sites) unless the client explicitly says the vehicle went outside —
      // re-derived here rather than trusted from the client.
      fuel_source:
        fuel_issued_liters > 0
          ? r.fuel_source === "outside"
            ? "outside"
            : isShraddhaPump
              ? "shraddha"
              : "on_site"
          : null,
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

// Record a barrel / diesel delivery arriving on site. RLS scopes this to the
// caller's own site (or admin). Barrels come at market price, so the rate
// defaults to the day's API diesel price for the site's state unless a
// manual "rate paid" is given. Shaped for useActionState.
export async function addFuelReceipt(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const project_id = String(formData.get("project_id") ?? "").trim();
  const receipt_date = String(formData.get("receipt_date") ?? "").trim();
  const liters = Number(formData.get("liters"));
  const barrelsRaw = String(formData.get("barrels") ?? "").trim();
  const rateRaw = String(formData.get("rate_per_liter") ?? "").trim();
  const vendor = String(formData.get("vendor") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!project_id) return "Missing site.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receipt_date)) return "Pick a valid date.";
  if (receipt_date > new Date().toISOString().slice(0, 10)) {
    return "The receipt date cannot be in the future.";
  }
  if (!(liters > 0)) return "Enter how many liters were received.";

  // Rate: manual override if given, else the day's API market rate for the
  // site's state. total_cost only when a rate is known.
  let rate: number | null = rateRaw !== "" ? Number(rateRaw) : null;
  if (rate == null || !(rate > 0)) {
    const { data: project } = await supabase
      .from("projects")
      .select("state")
      .eq("id", project_id)
      .single();
    const prices = await getPricesForCity(cityForState(project?.state ?? null), receipt_date);
    rate = prices.diesel;
  }
  const total_cost = rate != null ? Number((rate * liters).toFixed(2)) : null;

  const { error } = await supabase.from("fuel_receipts").insert({
    project_id,
    receipt_date,
    liters,
    barrels: barrelsRaw !== "" ? Number(barrelsRaw) : null,
    rate_per_liter: rate,
    total_cost,
    vendor,
    note,
    created_by: user.id,
  });
  if (error) return error.message;

  revalidatePath("/diesel");
  revalidatePath("/diesel/reports");
  return null;
}

// Remove a diesel-received entry (own site or admin, per RLS).
export async function deleteFuelReceipt(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("receipt_id") ?? "").trim();
  if (!id) return;

  await supabase.from("fuel_receipts").delete().eq("id", id);
  revalidatePath("/diesel");
  revalidatePath("/diesel/reports");
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
