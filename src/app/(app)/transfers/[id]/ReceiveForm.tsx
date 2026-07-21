"use client";

import { useActionState } from "react";
import { receiveTransfer } from "../actions";

type Line = {
  id: string;
  qty_sent: number;
  item: { code: string; description: string; unit: string } | null;
};

export function ReceiveForm({
  transferId,
  lines,
}: {
  transferId: string;
  lines: Line[];
}) {
  const [error, formAction, pending] = useActionState(receiveTransfer, null);

  return (
    <form
      action={formAction}
      className="rounded-lg border border-line bg-surface p-5 shadow-sm"
    >
      <h2 className="mb-1 text-base font-semibold">Confirm receipt</h2>
      <p className="mb-4 text-sm text-ink-2">
        Enter the quantity that actually arrived. Differences are flagged as a
        partial receipt.
      </p>
      <input type="hidden" name="transfer_id" value={transferId} />

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
            <th className="py-2">Item</th>
            <th className="py-2 text-right">Sent</th>
            <th className="py-2 text-right">Received</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="py-2">
                {l.item?.code} — {l.item?.description}
              </td>
              <td className="py-2 text-right tabular-nums text-ink-2">
                {Number(l.qty_sent).toLocaleString("en-IN")} {l.item?.unit}
              </td>
              <td className="py-2 text-right">
                <input
                  type="number"
                  name={`qty_${l.id}`}
                  defaultValue={l.qty_sent}
                  min="0"
                  step="any"
                  className="w-28 rounded-lg border border-line-strong px-2 py-1 text-right text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-lg bg-good px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Approving…" : "Approve receipt"}
      </button>
    </form>
  );
}
