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
  const readingRaw = get("current_reading");
  const track_fuel = formData.get("track_fuel") != null;
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
  // Starting reading only matters when fuel/meter is tracked.
  if (track_fuel && (readingRaw == null || Number(readingRaw) < 0)) {
    return "A starting reading is required — this is the only time it's typed in manually.";
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
    tank_capacity_liters: capacityRaw == null ? null : Number(capacityRaw),
    track_fuel,
    current_reading: track_fuel ? Number(readingRaw) : null,
    current_reading_at: track_fuel ? new Date().toISOString() : null,
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
  const track_fuel = formData.get("track_fuel") != null;
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
    registration_no,
    track_fuel,
    so_until, // null clears the deadline
  };
  // Only overwrite the current reading when a value is supplied, so an
  // edit that leaves it blank doesn't wipe the carried-forward meter.
  if (track_fuel && readingRaw != null && Number(readingRaw) >= 0) {
    updates.current_reading = Number(readingRaw);
    updates.current_reading_at = new Date().toISOString();
  }
  if (!track_fuel) {
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
