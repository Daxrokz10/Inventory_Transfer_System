"use client";

import { useState, useActionState } from "react";
import { setOpeningStock } from "./actions";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

// One-time (re-settable) opening barrel-stock count that anchors the running
// balance. Collapsed by default; shows the current anchor when set.
export function OpeningStockForm({
  projectId,
  current,
  today,
}: {
  projectId: string;
  current: { liters: number; as_of: string } | null;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await setOpeningStock(prev, fd);
      if (!result) setOpen(false);
      return result;
    },
    null,
  );

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {current ? (
          <span className="text-ink-2">
            Opening stock:{" "}
            <span className="font-mono tabular-nums text-ink">{current.liters} L</span>{" "}
            <span className="text-ink-3">as of {current.as_of}</span>
          </span>
        ) : (
          <span className="text-warn">No opening stock set — balance starts from 0.</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-accent hover:underline"
        >
          {current ? "Update" : "Set opening stock"}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Opening barrel stock</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-3 hover:text-ink">
          Cancel
        </button>
      </div>
      <p className="text-xs text-ink-3">
        A one-time physical count of diesel on site, in liters. The running balance is figured from
        this point on. Re-set it any time you take a fresh count.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Liters on hand">
          <Input
            type="number"
            name="liters"
            step="0.1"
            min="0"
            required
            defaultValue={current?.liters ?? ""}
            placeholder="e.g. 400"
          />
        </Field>
        <Field label="As of date">
          <Input type="date" name="as_of" max={today} required defaultValue={current?.as_of ?? today} />
        </Field>
        <Field label="Note" hint="Optional">
          <Input name="note" />
        </Field>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save opening stock"}
      </Button>
    </form>
  );
}
