"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? null;
  if (role !== "admin" && role !== "superadmin") redirect("/diesel");
  return { supabase, userId: user.id };
}

// Planning is an admin ("planning department") authority — file an
// upcoming requirement for a site: what machine type, how many, and the
// window it's needed for. Shaped for useActionState.
export async function addRequirement(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const { supabase, userId } = await requireAdmin();

  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const project_id = str("project_id");
  const machine_type = str("machine_type");
  const quantity = Number(str("quantity") || "1");
  const needed_from = str("needed_from");
  const needed_until = str("needed_until") || null;
  const note = str("note") || null;

  if (!project_id) return "Choose the site that needs this machine.";
  if (!machine_type) return "Choose (or type) the machine type needed.";
  if (!Number.isFinite(quantity) || quantity < 1) return "Quantity must be at least 1.";
  if (!needed_from) return "Choose the date the machine is needed from.";
  if (needed_until && needed_until < needed_from) {
    return "The \"needed until\" date can't be before the \"needed from\" date.";
  }

  const { error } = await supabase.from("site_requirements").insert({
    project_id,
    machine_type,
    quantity,
    needed_from,
    needed_until,
    note,
    created_by: userId,
  });
  if (error) return error.message;

  revalidatePath("/diesel/planning");
  return null;
}

export async function resolveRequirement(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("requirement_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || (status !== "fulfilled" && status !== "cancelled")) return;

  await supabase.from("site_requirements").update({ status }).eq("id", id);
  revalidatePath("/diesel/planning");
}

export async function deleteRequirement(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("requirement_id") ?? "");
  if (!id) return;

  await supabase.from("site_requirements").delete().eq("id", id);
  revalidatePath("/diesel/planning");
}
