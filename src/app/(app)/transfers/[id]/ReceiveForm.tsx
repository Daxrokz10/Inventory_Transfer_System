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
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <h2 className="mb-1 text-base font-semibold">Confirm receipt</h2>
      <p className="mb-4 text-sm text-gray-500">
        Enter the quantity that actually arrived. Differences are flagged as a
        partial receipt.
      </p>
      <input type="hidden" name="transfer_id" value={transferId} />

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
            <th className="py-2">Item</th>
            <th className="py-2 text-right">Sent</th>
            <th className="py-2 text-right">Received</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-50">
              <td className="py-2">
                {l.item?.code} — {l.item?.description}
              </td>
              <td className="py-2 text-right tabular-nums text-gray-600">
                {Number(l.qty_sent).toLocaleString("en-IN")} {l.item?.unit}
              </td>
              <td className="py-2 text-right">
                <input
                  type="number"
                  name={`qty_${l.id}`}
                  defaultValue={l.qty_sent}
                  min="0"
                  step="any"
                  className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-60"
      >
        {pending ? "Approving…" : "Approve receipt"}
      </button>
    </form>
  );
}
