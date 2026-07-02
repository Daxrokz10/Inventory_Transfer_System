"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type LineInput = { item_id: string; qty_sent: number; rate: number };

// Create a transfer and dispatch it (status -> dispatched). Stock leaves the
// source site immediately as in-transit; the receiver confirms later.
// Shaped for useActionState: returns an error string, or redirects on success.
export async function createTransfer(
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

  const from_project_id = get("from_project_id");
  const to_project_id = get("to_project_id");
  if (!from_project_id || !to_project_id) {
    return "Both source and destination sites are required.";
  }
  if (from_project_id === to_project_id) {
    return "Source and destination must be different sites.";
  }

  let lines: LineInput[] = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return "Could not read line items.";
  }
  lines = lines.filter((l) => l.item_id && Number(l.qty_sent) > 0);
  if (lines.length === 0) {
    return "Add at least one item with a quantity greater than zero.";
  }

  const { data: transfer, error: tErr } = await supabase
    .from("transfers")
    .insert({
      from_project_id,
      to_project_id,
      status: "dispatched",
      transfer_date:
        get("transfer_date") ?? new Date().toISOString().slice(0, 10),
      challan_no: get("challan_no"),
      lr_no: get("lr_no"),
      vehicle_no: get("vehicle_no"),
      eway_bill_no: get("eway_bill_no"),
      eway_bill_date: get("eway_bill_date"),
      transporter_name: get("transporter_name"),
      transporter_id: get("transporter_id"),
      remarks: get("remarks"),
      created_by: user.id,
      dispatched_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (tErr) return tErr.message;

  const { error: lErr } = await supabase.from("transfer_lines").insert(
    lines.map((l) => ({
      transfer_id: transfer.id,
      item_id: l.item_id,
      qty_sent: Number(l.qty_sent),
      rate: Number(l.rate) || 0,
    })),
  );
  if (lErr) {
    await supabase.from("transfers").delete().eq("id", transfer.id);
    return lErr.message;
  }

  revalidatePath("/transfers");
  revalidatePath("/dashboard");
  redirect(`/transfers/${transfer.id}`);
}

// Receiver confirms actual quantities. Status becomes 'received' if every line
// matches what was sent, otherwise 'partial' (shortage/excess flagged).
export async function receiveTransfer(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const transferId = String(formData.get("transfer_id") ?? "");
  if (!transferId) return "Missing transfer reference.";

  const { data: lines, error: lErr } = await supabase
    .from("transfer_lines")
    .select("id, qty_sent")
    .eq("transfer_id", transferId);
  if (lErr) return lErr.message;

  let allMatch = true;
  for (const line of lines ?? []) {
    const raw = formData.get(`qty_${line.id}`);
    const received = raw == null || raw === "" ? 0 : Number(raw);
    if (received !== Number(line.qty_sent)) allMatch = false;
    const { error } = await supabase
      .from("transfer_lines")
      .update({ qty_received: received })
      .eq("id", line.id);
    if (error) return error.message;
  }

  const { error: uErr } = await supabase
    .from("transfers")
    .update({
      status: allMatch ? "received" : "partial",
      received_by: user.id,
      received_at: new Date().toISOString(),
    })
    .eq("id", transferId);
  if (uErr) return uErr.message;

  revalidatePath("/transfers");
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  redirect(`/transfers/${transferId}`);
}
