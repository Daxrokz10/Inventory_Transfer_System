"use client";

import { useActionState } from "react";
import { deleteTransfer } from "../actions";

export function DeleteTransferForm({
  transferId,
  received,
}: {
  transferId: string;
  received: boolean;
}) {
  const [error, action, pending] = useActionState(deleteTransfer, null);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const msg = received
          ? "Delete this transfer? It has already been received, so deleting it will REVERSE the stock movement (source regains its quantity, destination loses it). This cannot be undone."
          : "Delete this transfer? This cannot be undone.";
        if (!confirm(msg)) e.preventDefault();
      }}
      className="inline-flex flex-col items-end gap-1"
    >
      <input type="hidden" name="transfer_id" value={transferId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Delete transfer"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
