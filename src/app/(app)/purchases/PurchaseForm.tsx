"use client";

import { useActionState, useMemo, useState } from "react";
import { createPurchase } from "./actions";

type Project = { id: string; code: string; name: string };
type Item = { id: string; code: string; description: string; unit: string; sub_group: string | null; per_day_rate: number };

const field =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full";
const label = "flex flex-col gap-1 text-sm text-gray-600";

export function PurchaseForm({
  items,
  projects,
  defaultProject,
}: {
  items: Item[];
  projects: Project[];
  defaultProject: string | null;
}) {
  const [done, setDone] = useState(false);
  const [error, action, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await createPurchase(prev, fd);
      if (!result) {
        (document.getElementById("purchase-form") as HTMLFormElement)?.reset();
        setDone(true);
      }
      return result;
    },
    null,
  );

  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const amount = (Number(qty) || 0) * (Number(rate) || 0);

  const onItemChange = (id: string) => {
    setItemId(id);
    const it = itemById.get(id);
    setRate(it ? String(it.per_day_rate ?? 0) : "");
    setDone(false);
  };

  return (
    <form
      id="purchase-form"
      action={action}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Item *
          <select
            name="item_id"
            required
            value={itemId}
            onChange={(e) => onItemChange(e.target.value)}
            className={field}
          >
            <option value="">Select item…</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.code} — {it.description}
                {it.sub_group ? ` · ${it.sub_group}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Assign to site *
          <select name="project_id" required defaultValue={defaultProject ?? ""} className={field}>
            <option value="">Select site…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Quantity *
          <input
            name="qty"
            type="number"
            min="0"
            step="any"
            required
            value={qty}
            onChange={(e) => { setQty(e.target.value); setDone(false); }}
            placeholder="0"
            className={field}
          />
        </label>
        <label className={label}>
          Rate <span className="text-gray-400">(optional)</span>
          <input
            name="rate"
            type="number"
            min="0"
            step="any"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="0"
            className={field}
          />
        </label>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          Amount:{" "}
          <span className="font-semibold tabular-nums text-gray-800">
            {amount.toLocaleString("en-IN")}
          </span>
        </span>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}
      {done && !error && (
        <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          Purchase recorded — stock added to the site.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Record purchase"}
      </button>
    </form>
  );
}
