"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    gstin: str("gstin") || null,
    branch: str("branch") || null,
    transporter_name: str("transporter_name") || null,
  });
  if (error) {
    if (error.code === "23505") return `A site with code "${code}" already exists.`;
    return error.message;
  }

  revalidatePath("/masters/sites");
  revalidatePath("/masters/projects");
  return null;
}
