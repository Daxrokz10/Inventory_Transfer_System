"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPricesForCity } from "@/lib/diesel/fuelPrice";
import { cityForState } from "@/lib/diesel/types";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? null;
  if (role !== "admin" && role !== "superadmin") redirect("/dashboard");
  return supabase;
}

export async function createSite(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await requireAdmin();

  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const code = str("code");
  const name = str("name");
  if (!code) return "Site code is required.";
  if (!name) return "Site name is required.";
  if (code.toUpperCase() === "J-0000") {
    return "J-0000 is reserved for purchases and cannot be used for a site.";
  }

  const { error } = await supabase.from("projects").insert({
    code,
    name,
    address: str("address") || null,
    state: str("state") || null,
    gstin: str("gstin") || null,
    branch: str("branch") || null,
    transporter_name: str("transporter_name") || null,
  });
  if (error) {
    if (error.code === "23505") return `A site with code "${code}" already exists.`;
    return error.message;
  }

  revalidatePath("/diesel/sites");
  revalidatePath("/masters/projects");
  return null;
}

// Set/change the state of an existing site — this drives the daily fuel
// price lookup (each state maps to one reference city, queried on
// goodreturns.in). Fetches today's price right away so the Sites page
// reflects it immediately, rather than waiting for a daily report.
export async function updateSiteState(formData: FormData): Promise<void> {
  const supabase = await requireAdmin();
  const id = String(formData.get("project_id") ?? "");
  const state = String(formData.get("state") ?? "").trim() || null;
  if (!id) return;

  await supabase.from("projects").update({ state }).eq("id", id);

  const city = cityForState(state);
  if (city) {
    const today = new Date().toISOString().slice(0, 10);
    await getPricesForCity(city, today);
  }

  revalidatePath("/diesel/sites");
  revalidatePath("/diesel");
}
