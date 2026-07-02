import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReceiveForm } from "./ReceiveForm";

const statusStyles: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  dispatched: "bg-amber-100 text-amber-800",
  received: "bg-green-100 text-green-800",
  partial: "bg-orange-100 text-orange-800",
  cancelled: "bg-red-100 text-red-700",
};

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm text-gray-800">{value || "—"}</p>
    </div>
  );
}

export default async function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role, home_project_id").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";

  const { data: t } = await supabase
    .from("transfers")
    .select(
      "*, from_project:from_project_id(code, name), to_project:to_project_id(code, name)",
    )
    .eq("id", id)
    .single();

  if (!t) notFound();

  // Only the receiving site's store manager (or an admin/superadmin) may confirm receipt.
  const canReceive = isAdmin || profile?.home_project_id === t.to_project_id;

  const { data: lines } = await supabase
    .from("transfer_lines")
    .select("id, qty_sent, qty_received, rate, item:item_id(code, description, unit)")
    .eq("transfer_id", id);

  const from = t.from_project as unknown as { code: string; name: string } | null;
  const to = t.to_project as unknown as { code: string; name: string } | null;
  const rows = (lines ?? []) as unknown as {
    id: string;
    qty_sent: number;
    qty_received: number | null;
    rate: number;
    item: { code: string; description: string; unit: string } | null;
  }[];

  const total = rows.reduce(
    (s, r) => s + Number(r.qty_sent) * Number(r.rate ?? 0),
    0,
  );
  const showReceive = t.status === "dispatched" && canReceive;
  const awaitingOther = t.status === "dispatched" && !canReceive;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/transfers"
            className="text-sm text-blue-600 hover:underline"
          >
            ← All transfers
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {t.challan_no || "Transfer"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/transfers/${id}/challan`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View challan
          </Link>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              statusStyles[t.status] ?? "bg-gray-100"
            }`}
          >
            {t.status}
          </span>
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="From" value={from ? `${from.code} — ${from.name}` : null} />
          <Field label="To" value={to ? `${to.code} — ${to.name}` : null} />
          <Field label="Date" value={t.transfer_date} />
          <Field label="Vehicle" value={t.vehicle_no} />
          <Field label="LR no." value={t.lr_no} />
          <Field label="E-way bill" value={t.eway_bill_no} />
          <Field label="Transporter" value={t.transporter_name} />
          <Field label="Remarks" value={t.remarks} />
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">Items</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Sent</th>
              <th className="py-2 text-right">Received</th>
              <th className="py-2 text-right">Rate</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const short =
                r.qty_received != null &&
                Number(r.qty_received) !== Number(r.qty_sent);
              return (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="py-2">
                    {r.item?.code} — {r.item?.description}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(r.qty_sent).toLocaleString("en-IN")} {r.item?.unit}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums ${
                      short ? "font-medium text-orange-600" : "text-gray-600"
                    }`}
                  >
                    {r.qty_received == null
                      ? "—"
                      : Number(r.qty_received).toLocaleString("en-IN")}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-600">
                    {Number(r.rate ?? 0).toLocaleString("en-IN")}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {(Number(r.qty_sent) * Number(r.rate ?? 0)).toLocaleString(
                      "en-IN",
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-2 text-right text-gray-500">
                Total
              </td>
              <td className="py-2 text-right font-semibold tabular-nums">
                {total.toLocaleString("en-IN")}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {showReceive && (
        <ReceiveForm
          transferId={id}
          lines={rows.map((r) => ({
            id: r.id,
            qty_sent: Number(r.qty_sent),
            item: r.item,
          }))}
        />
      )}

      {awaitingOther && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          In transit — only the receiving site
          {to ? ` (${to.code})` : ""} or an administrator can confirm receipt.
        </p>
      )}
    </div>
  );
}
