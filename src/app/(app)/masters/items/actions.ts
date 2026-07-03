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

export async function createItem(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await requireAdmin();

  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const code = str("code");
  const description = str("description");
  if (!code) return "Item code is required.";
  if (!description) return "Description is required.";

  const { error } = await supabase.from("items").insert({
    code,
    description,
    unit: str("unit") || "NOS",
    sub_group: str("sub_group") || null,
    main_group: str("main_group") || null,
    hsn_code: str("hsn_code") || null,
    per_day_rate: Number(formData.get("per_day_rate")) || 0,
  });
  if (error) {
    if (error.code === "23505") return `An item with code "${code}" already exists.`;
    return error.message;
  }

  revalidatePath("/masters/items");
  return null;
}

export async function updateItem(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await requireAdmin();

  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const id = str("id");
  const code = str("code");
  const description = str("description");
  if (!id) return "Missing item reference.";
  if (!code) return "Item code is required.";
  if (!description) return "Description is required.";

  const { error } = await supabase
    .from("items")
    .update({
      code,
      description,
      unit: str("unit") || "NOS",
      sub_group: str("sub_group") || null,
      main_group: str("main_group") || null,
      hsn_code: str("hsn_code") || null,
      per_day_rate: Number(formData.get("per_day_rate")) || 0,
    })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") return `An item with code "${code}" already exists.`;
    return error.message;
  }

  revalidatePath("/masters/items");
  return null;
}

export async function deleteItem(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return "Missing item reference.";

  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) {
    // FK violation — item is referenced by transfers.
    if (error.code === "23503") {
      return "This item is used in one or more transfers and cannot be deleted.";
    }
    return error.message;
  }

  revalidatePath("/masters/items");
  return null;
}
