// One-off check that the transfer workflow drives stock_balances correctly.
// Creates a temporary transfer, verifies balances, then deletes it.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
const require = createRequire(import.meta.url);

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const onHand = async (project_id, item_id) => {
  const { data } = await sb
    .from("stock_balances")
    .select("on_hand")
    .eq("project_id", project_id)
    .eq("item_id", item_id)
    .maybeSingle();
  return Number(data?.on_hand ?? 0);
};

async function main() {
  // Pick an opening balance with qty >= 5 as our source.
  const { data: ob } = await sb
    .from("opening_balances")
    .select("project_id, item_id, qty")
    .gte("qty", 5)
    .limit(1)
    .single();
  const from = ob.project_id;
  const item = ob.item_id;

  // A different project as destination.
  const { data: other } = await sb
    .from("projects")
    .select("id")
    .neq("id", from)
    .limit(1)
    .single();
  const to = other.id;

  const QTY = 5;
  const fromBefore = await onHand(from, item);
  const toBefore = await onHand(to, item);

  const { data: t } = await sb
    .from("transfers")
    .insert({ from_project_id: from, to_project_id: to, status: "dispatched" })
    .select("id")
    .single();
  await sb
    .from("transfer_lines")
    .insert({ transfer_id: t.id, item_id: item, qty_sent: QTY, rate: 0 });

  const fromDispatched = await onHand(from, item);
  const toDispatched = await onHand(to, item);

  // Receiver confirms full quantity.
  await sb
    .from("transfer_lines")
    .update({ qty_received: QTY })
    .eq("transfer_id", t.id);
  await sb.from("transfers").update({ status: "received" }).eq("id", t.id);

  const fromReceived = await onHand(from, item);
  const toReceived = await onHand(to, item);

  // Clean up.
  await sb.from("transfers").delete().eq("id", t.id);
  const fromAfter = await onHand(from, item);
  const toAfter = await onHand(to, item);

  const ok =
    fromDispatched === fromBefore - QTY &&
    toDispatched === toBefore && // not received yet -> destination unchanged
    toReceived === toBefore + QTY &&
    fromAfter === fromBefore &&
    toAfter === toBefore;

  console.log("SOURCE on_hand:", { fromBefore, fromDispatched, fromReceived, fromAfter });
  console.log("DEST   on_hand:", { toBefore, toDispatched, toReceived, toAfter });
  console.log(ok ? "\n✅ Workflow + balances verified, test data removed." : "\n❌ Mismatch — check view logic.");
  if (!ok) process.exit(1);
}
main().catch((e) => {
  console.error("VERIFY FAILED:", e.message ?? e);
  process.exit(1);
});
