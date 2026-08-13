"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Register a machine at a site. Supervisors may only add machines at their
// own site (enforced by RLS insert policy); admins can pick any site.
// Shaped for useActionState: returns an error string, or null on success.
export async function addMachine(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const get = (k: string) => {
    const v = formData.get(k);
    return v == null || v === "" ? null : String(v);
  };

  const project_id = get("project_id");
  const name = get("name");
  const machine_type = get("machine_type");
  const reading_type = get("reading_type");
  const fuel_type = get("fuel_type");
  const ownership = get("ownership");
  const vendor_name = get("vendor_name");
  const registration_no = get("registration_no");
  const capacityRaw = get("tank_capacity_liters");
  const monthlyRentRaw = get("monthly_rent");
  const readingRaw = get("current_reading");
  const meter_broken = formData.get("meter_broken") === "true";
  const track_fuel = formData.get("track_fuel") != null;
  const track_meter = track_fuel || formData.get("track_meter") != null;
  const so_until = get("so_until"); // YYYY-MM-DD or null

  if (!project_id || !name || !machine_type) {
    return "Site, machine name, and machine type are required.";
  }
  if (reading_type !== "km" && reading_type !== "hours") {
    return "Choose how this machine is metered (km or hours).";
  }
  if (fuel_type !== "diesel" && fuel_type !== "petrol") {
    return "Choose the machine's fuel (diesel or petrol).";
  }
  if (ownership !== "internal" && ownership !== "external") {
    return "Choose whether the machine is internal or external.";
  }
  // Only admins register company-owned (internal) machinery. Site
  // supervisors may add hired (external) machines at their own site.
  if (ownership === "internal" && !(await isCallerAdmin(supabase, user.id))) {
    return "Only an admin can add internal (company-owned) machinery. Supervisors can register hired (external) machines.";
  }
  if (ownership === "external" && !vendor_name) {
    return "Vendor name is required for external (hired) machines.";
  }
  if (ownership === "external") {
    const internalError = await checkNotActuallyInternal(supabase, registration_no, vendor_name);
    if (internalError) return internalError;
  }
  // Starting reading only matters when a reading is tracked at all AND the
  // meter isn't already flagged broken at registration. Must be a real,
  // positive reading — a placeholder 0 here is what makes a machine's
  // first daily report compute an impossible efficiency (its entire
  // life-to-date distance divided into one day's fuel).
  if (track_meter && !meter_broken && (readingRaw == null || Number(readingRaw) <= 0)) {
    return "A real starting reading is required (not 0) — this is the only time it's typed in manually, and every day after carries it forward automatically.";
  }

  const { error } = await supabase.from("machines").insert({
    project_id,
    name,
    machine_type,
    registration_no,
    reading_type,
    fuel_type,
    ownership,
    vendor_name: ownership === "external" ? vendor_name : null,
    monthly_rent: ownership === "external" && monthlyRentRaw != null ? Number(monthlyRentRaw) : null,
    tank_capacity_liters: capacityRaw == null ? null : Number(capacityRaw),
    track_fuel,
    track_meter,
    meter_broken,
    current_reading: track_meter && !meter_broken ? Number(readingRaw) : null,
    current_reading_at: track_meter && !meter_broken ? new Date().toISOString() : null,
    deployed_at: new Date().toISOString().slice(0, 10),
    so_until,
    created_by: user.id,
  });
  if (error) {
    if (error.code === "23505") {
      return "A machine with this numberplate is already registered at this site.";
    }
    // RLS violation surfaces here if a supervisor tries another site.
    return error.message;
  }

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
  return null;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// "Shree Ganesh Corporation" is SGC itself, not a real hire vendor — a
// machine tagged with it as the vendor is company-owned wearing an
// external label (as happened with the Ajax at J-0069). Catch that
// mislabeling at the source: block it whether it shows up as the vendor
// name being typed in now, or because the numberplate already exists on
// an internal (or SGC-vendor) record somewhere else in the fleet.
const SGC_VENDOR_RE = /SHREE\s*GANESH\s*CORPORATION/i;

async function checkNotActuallyInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  registration_no: string | null,
  vendor_name: string | null,
): Promise<string | null> {
  if (vendor_name && SGC_VENDOR_RE.test(vendor_name)) {
    return "This is an internal (company-owned) machine, not a hired one — the vendor can't be Shree Ganesh Corporation. Only an admin can add internal machinery.";
  }
  if (!registration_no) return null;

  const target = norm(registration_no);
  const { data: candidates } = await supabase
    .from("machines")
    .select("registration_no, ownership, vendor_name, project_id, is_active")
    .not("registration_no", "is", null);

  const match = (candidates ?? []).find(
    (m) => m.is_active && m.registration_no && norm(m.registration_no) === target,
  );
  if (!match) return null;

  const isInternal = match.ownership === "internal" || SGC_VENDOR_RE.test(match.vendor_name ?? "");
  if (!isInternal) return null;

  const { data: project } = await supabase
    .from("projects")
    .select("name, code")
    .eq("id", match.project_id)
    .single();
  const site = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "another site";

  return `This machine is internal (company-owned), currently at ${site} — you can only add hired (external) machines. Ask an admin to transfer it here instead.`;
}

async function loadMachine(
  supabase: Awaited<ReturnType<typeof createClient>>,
  machineId: string,
) {
  const { data } = await supabase
    .from("machines")
    .select("id, ownership, project_id")
    .eq("id", machineId)
    .single();
  return data;
}

async function isCallerAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  return data?.role === "admin" || data?.role === "superadmin";
}

// Admin-only: edit a machine's attributes (name, type, fuel, meter,
// numberplate, ownership/vendor, fuel-tracking, and — when tracked — its
// current reading). Site changes go through transferMachine, not here.
export async function updateMachine(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isCallerAdmin(supabase, user.id))) return "Admin access required.";

  const get = (k: string) => {
    const v = formData.get(k);
    return v == null || v === "" ? null : String(v);
  };

  const id = get("machine_id");
  const name = get("name");
  const machine_type = get("machine_type");
  const reading_type = get("reading_type");
  const fuel_type = get("fuel_type");
  const ownership = get("ownership");
  const vendor_name = get("vendor_name");
  const registration_no = get("registration_no");
  const monthlyRentRaw = get("monthly_rent");
  const track_fuel = formData.get("track_fuel") != null;
  const track_meter = track_fuel || formData.get("track_meter") != null;
  const readingRaw = get("current_reading");
  const so_until = get("so_until"); // YYYY-MM-DD, or null to clear

  if (!id || !name || !machine_type) {
    return "Machine name and type are required.";
  }
  if (reading_type !== "km" && reading_type !== "hours") {
    return "Choose how this machine is metered (km or hours).";
  }
  if (fuel_type !== "diesel" && fuel_type !== "petrol") {
    return "Choose the machine's fuel (diesel or petrol).";
  }
  if (ownership !== "internal" && ownership !== "external") {
    return "Choose whether the machine is internal or external.";
  }
  if (ownership === "external" && !vendor_name) {
    return "Vendor name is required for external (hired) machines.";
  }

  const updates: Record<string, unknown> = {
    name,
    machine_type,
    reading_type,
    fuel_type,
    ownership,
    vendor_name: ownership === "external" ? vendor_name : null,
    monthly_rent: ownership === "external" && monthlyRentRaw != null ? Number(monthlyRentRaw) : null,
    registration_no,
    track_fuel,
    track_meter,
    so_until, // null clears the deadline
  };
  // Only overwrite the current reading when a value is supplied, so an
  // edit that leaves it blank doesn't wipe the carried-forward meter.
  if (track_meter && readingRaw != null && Number(readingRaw) >= 0) {
    updates.current_reading = Number(readingRaw);
    updates.current_reading_at = new Date().toISOString();
  }
  if (!track_meter) {
    updates.current_reading = null;
    updates.current_reading_at = null;
  }

  const { error } = await supabase.from("machines").update(updates).eq("id", id);
  if (error) {
    if (error.code === "23505") {
      return "A machine with this numberplate is already registered at this site.";
    }
    return error.message;
  }

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
  return null;
}

// Admin-only. Internal machines are never hard-deleted — just hidden
// from the daily report and the active machinery list, with history
// intact.
export async function deactivateMachine(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isCallerAdmin(supabase, user.id))) return;

  const machine_id = String(formData.get("machine_id") ?? "");
  if (!machine_id) return;

  await supabase.from("machines").update({ is_active: false }).eq("id", machine_id);

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
}

// Admin-only: bring a deactivated machine back.
export async function reactivateMachine(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isCallerAdmin(supabase, user.id))) return;

  const machine_id = String(formData.get("machine_id") ?? "");
  if (!machine_id) return;

  await supabase.from("machines").update({ is_active: true }).eq("id", machine_id);

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
}

// Admin-only. Permanent delete — external (hired) machines only. Once a
// hired machine is returned there's no need to keep its record, unlike
// internal machines whose history stays intact via deactivateMachine.
export async function deleteMachine(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isCallerAdmin(supabase, user.id))) return;

  const machine_id = String(formData.get("machine_id") ?? "");
  if (!machine_id) return;

  const machine = await loadMachine(supabase, machine_id);
  if (!machine || machine.ownership !== "external") return;

  await supabase.from("machines").delete().eq("id", machine_id);

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
}

// Site supervisor (or admin) files a renewal/removal request for a
// machine at their own site. RLS enforces the site scoping; the unique
// index enforces one open request per type. Shaped for useActionState.
export async function requestMachineChange(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const machine_id = String(formData.get("machine_id") ?? "");
  const type = String(formData.get("type") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!machine_id || (type !== "renewal" && type !== "removal")) {
    return "Pick what you're requesting.";
  }

  const machine = await loadMachine(supabase, machine_id);
  if (!machine) return "That machine no longer exists.";
  // External machines have their own self-service removal (removeHiredMachine
  // → the remove_hired_machine RPC) that needs no admin approval — a removal
  // REQUEST for one would just make the site wait on something they can
  // already do themselves. The UI hides this option for external machines;
  // this rejects it server-side too, so posting the form directly can't get
  // around that.
  if (type === "removal" && machine.ownership === "external") {
    return "External machines can be removed directly from the Machinery list — no admin approval needed.";
  }

  const { error } = await supabase.from("machine_requests").insert({
    machine_id,
    project_id: machine.project_id,
    type,
    note,
    requested_by: user.id,
  });
  if (error) {
    // Unique partial index: an open request of this type already exists.
    if (error.code === "23505") {
      return "There's already an open request of this kind for this machine.";
    }
    return error.message;
  }

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
  return null;
}

// Admin-only: act on a pending request. Approving a renewal sets the new
// SO date on the machine; approving a removal takes it out of service
// (external machines are deleted, internal machines deactivated so their
// history survives). Either way the request is closed.
export async function resolveMachineRequest(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isCallerAdmin(supabase, user.id))) return;

  const request_id = String(formData.get("request_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const so_until = String(formData.get("so_until") ?? "") || null;
  const resolution_note = String(formData.get("resolution_note") ?? "").trim() || null;
  if (!request_id || (decision !== "approve" && decision !== "reject")) return;

  const { data: req } = await supabase
    .from("machine_requests")
    .select("id, machine_id, type, status")
    .eq("id", request_id)
    .single();
  if (!req || req.status !== "pending") return;

  if (decision === "approve") {
    if (req.type === "renewal") {
      // A renewal must land on a concrete new expiry date.
      if (!so_until) return;
      await supabase
        .from("machines")
        .update({ so_until })
        .eq("id", req.machine_id);
    } else {
      const machine = await loadMachine(supabase, req.machine_id);
      if (machine) {
        if (machine.ownership === "external") {
          await supabase.from("machines").delete().eq("id", req.machine_id);
        } else {
          await supabase
            .from("machines")
            .update({ is_active: false })
            .eq("id", req.machine_id);
        }
      }
    }
  }

  await supabase
    .from("machine_requests")
    .update({
      status: decision === "approve" ? "approved" : "rejected",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note,
    })
    .eq("id", request_id);

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
}

// Site person (or admin) retires a hired (external) machine when the hire
// ends. Deactivates it — keeps its diesel history — and the DB function
// enforces external-only + own-site, so this is safe even if called directly.
export async function removeHiredMachine(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const machine_id = String(formData.get("machine_id") ?? "");
  if (!machine_id) return;

  await supabase.rpc("remove_hired_machine", { p_machine_id: machine_id });

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
}

// Flag or clear a machine's broken-meter status. A supervisor can only set
// it (true) for their own site's machine; clearing it (false) is
// admin-only. Both rules are enforced in the set_meter_broken() DB
// function, not just here, so this is defense in depth.
export async function setMeterBroken(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const machine_id = String(formData.get("machine_id") ?? "");
  const broken = formData.get("broken") === "true";
  if (!machine_id) return;

  await supabase.rpc("set_meter_broken", { p_machine_id: machine_id, p_broken: broken });

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
}

// Admin-only: mark/unmark a machine for closer scrutiny. No formal
// meaning — just a way for an admin to flag one to keep an eye on.
export async function setSuspicious(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isCallerAdmin(supabase, user.id))) return;

  const machine_id = String(formData.get("machine_id") ?? "");
  const suspicious = formData.get("suspicious") === "true";
  if (!machine_id) return;

  await supabase.from("machines").update({ flagged_suspicious: suspicious }).eq("id", machine_id);

  revalidatePath("/diesel/machines");
  revalidatePath(`/diesel/machines/${machine_id}`);
}

// Admin-only: move an internal machine to a different site. Same machine
// record, same history — just relocated, instead of deleting and
// re-registering it (which would lose everything).
export async function transferMachine(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isCallerAdmin(supabase, user.id))) return;

  const machine_id = String(formData.get("machine_id") ?? "");
  const project_id = String(formData.get("project_id") ?? "");
  if (!machine_id || !project_id) return;

  // A transfer starts a fresh deployment at the new site: reset the start
  // date and clear the old site's SO deadline (a new one is set there if
  // needed) so a moved machine never carries a stale overdue flag.
  await supabase
    .from("machines")
    .update({
      project_id,
      deployed_at: new Date().toISOString().slice(0, 10),
      so_until: null,
    })
    .eq("id", machine_id);

  revalidatePath("/diesel/machines");
  revalidatePath("/diesel");
}
