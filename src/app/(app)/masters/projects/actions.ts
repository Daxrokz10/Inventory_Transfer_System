"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canEditClosingBalance } from "./constants";

// Set the on-hand quantity of one item at one site.
//
// stock_balances is a computed view, so we don't write to it. We record the
// difference as a signed adjustment; the view sums adjustments in, so the
// resulting on-hand equals exactly what was typed. Append-only and auditable.
export async function adjustStockQty(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Authorisation is by explicit account, not by role.
  if (!canEditClosingBalance(user.email)) {
    return "Your account is not allowed to edit closing balance.";
  }

  const project_id = String(formData.get("project_id") ?? "").trim();
  const item_id = String(formData.get("item_id") ?? "").trim();
  const raw = String(formData.get("qty") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!project_id || !item_id) return "Missing item or site reference.";
  if (raw === "") return "Enter a quantity.";

  const newQty = Number(raw);
  if (!Number.isFinite(newQty)) return "Quantity must be a number.";

  // Current on-hand for this cell (may be absent → treat as 0).
  const { data: bal, error: bErr } = await supabase
    .from("stock_balances")
    .select("on_hand")
    .eq("project_id", project_id)
    .eq("item_id", item_id)
    .maybeSingle();
  if (bErr) return bErr.message;

  const current = Number(bal?.on_hand ?? 0);
  const delta = newQty - current;
  if (Math.abs(delta) < 1e-9) return null; // nothing changed

  const { error } = await supabase.from("stock_adjustments").insert({
    project_id,
    item_id,
    delta,
    previous_qty: current,
    new_qty: newQty,
    reason,
    created_by: user.id,
  });
  if (error) {
    // Table missing → migration 0027 hasn't been applied yet.
    if (error.code === "42P01" || error.message.includes("stock_adjustments")) {
      return "Stock adjustments are not set up yet — run migration 0031 in Supabase.";
    }
    return error.message;
  }

  revalidatePath("/masters/projects");
  revalidatePath("/masters/items");
  revalidatePath("/dashboard");
  return null;
}
