"use client";

import { useState, useActionState } from "react";
import { addFuelReceipt } from "./actions";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

// Record a barrel / diesel delivery arriving at this site. Liters is the
// only required field; the rate defaults to the day's market price unless a
// "rate paid" is entered. Kept collapsed until opened so it doesn't crowd
// the daily sheet.
export function FuelReceiptForm({
  projectId,
  today,
}: {
  projectId: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await addFuelReceipt(prev, fd);
      if (!result) setOpen(false);
      return result;
    },
    null,
  );

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Record diesel received
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Diesel received</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Date">
          <Input type="date" name="receipt_date" defaultValue={today} max={today} required />
        </Field>
        <Field label="Liters received">
          <Input type="number" name="liters" step="0.1" min="0" required placeholder="e.g. 200" />
        </Field>
        <Field label="Barrels" hint="Optional — number of drums">
          <Input type="number" name="barrels" step="1" min="0" placeholder="e.g. 1" />
        </Field>
        <Field label="Rate paid ₹/L" hint="Leave blank to use the day's market price">
          <Input type="number" name="rate_per_liter" step="0.01" min="0" placeholder="market rate" />
        </Field>
        <Field label="Vendor" hint="Optional">
          <Input name="vendor" placeholder="Supplier name" />
        </Field>
        <Field label="Note" hint="Optional">
          <Input name="note" />
        </Field>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save receipt"}
      </Button>
    </form>
  );
}
