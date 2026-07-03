"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PURCHASE_CODE } from "./constants";

// The purchase source is a reserved pseudo-site (code J-0000). A purchase is
// recorded as a transfer FROM J-0000 INTO the destination site, immediately
// marked received so the stock lands right away.
async function ensurePurchaseProjectId(): Promise<string> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("projects")
    .select("id")
    .eq("code", PURCHASE_CODE)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("projects")
    .insert({ code: PURCHASE_CODE, name: "Purchase (external)", is_active: true })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

export async function createPurchase(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? null;
  if (role !== "admin" && role !== "superadmin") {
    return "Only an admin or superadmin can record purchases.";
  }

  const item_id = String(formData.get("item_id") ?? "").trim();
  const project_id = String(formData.get("project_id") ?? "").trim();
  const qty = Number(formData.get("qty"));
  const rate = Number(formData.get("rate")) || 0;

  if (!item_id) return "Select an item.";
  if (!project_id) return "Select the site the material is assigned to.";
  if (!(qty > 0)) return "Quantity must be greater than zero.";

  const purchaseProjectId = await ensurePurchaseProjectId();
  if (project_id === purchaseProjectId) {
    return "Choose a real destination site, not the purchase source.";
  }

  const now = new Date().toISOString();
  const { data: transfer, error: tErr } = await supabase
    .from("transfers")
    .insert({
      from_project_id: purchaseProjectId,
      to_project_id: project_id,
      status: "received",
      transfer_date: new Date().toISOString().slice(0, 10),
      remarks: "Purchase",
      created_by: user.id,
      dispatched_at: now,
      received_by: user.id,
      received_at: now,
    })
    .select("id")
    .single();
  if (tErr) return tErr.message;

  const { error: lErr } = await supabase.from("transfer_lines").insert({
    transfer_id: transfer.id,
    item_id,
    qty_sent: qty,
    qty_received: qty,
    rate,
  });
  if (lErr) {
    await supabase.from("transfers").delete().eq("id", transfer.id);
    return lErr.message;
  }

  revalidatePath("/purchases");
  revalidatePath("/transactions");
  revalidatePath("/masters/projects");
  revalidatePath("/masters/items");
  revalidatePath("/dashboard");
  return null;
}
