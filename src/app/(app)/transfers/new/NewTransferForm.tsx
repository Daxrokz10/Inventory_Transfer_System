"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { createTransfer } from "../actions";

type Project = { id: string; code: string; name: string };
type Item = { id: string; code: string; description: string; unit: string; per_day_rate: number };
type Line = { key: number; item_id: string; qty_sent: string; rate: string };

let nextKey = 1;
const blankLine = (): Line => ({
  key: nextKey++,
  item_id: "",
  qty_sent: "",
  rate: "",
});

export function NewTransferForm({
  projects,
  items,
  defaultFromProject,
}: {
  projects: Project[];
  items: Item[];
  defaultFromProject: string | null;
}) {
  const [error, formAction, pending] = useActionState(createTransfer, null);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [fromProjectId, setFromProjectId] = useState(defaultFromProject ?? "");
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [stockLoading, setStockLoading] = useState(false);

  const itemById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );

  // Fetch stock balances for the selected from-site whenever it changes
  useEffect(() => {
    if (!fromProjectId) {
      setStockMap(new Map());
      return;
    }
    setStockLoading(true);
    fetch(`/api/stock?project_id=${fromProjectId}`)
      .then((r) => r.json())
      .then((rows: { item_id: string; on_hand: number }[]) => {
        setStockMap(new Map(rows.map((r) => [r.item_id, Number(r.on_hand)])));
      })
      .catch(() => setStockMap(new Map()))
      .finally(() => setStockLoading(false));
  }, [fromProjectId]);

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onItemChange = (key: number, item_id: string) => {
    const it = itemById.get(item_id);
    updateLine(key, { item_id, rate: it ? String(it.per_day_rate ?? 0) : "" });
  };

  const total = lines.reduce(
    (sum, l) => sum + (Number(l.qty_sent) || 0) * (Number(l.rate) || 0),
    0,
  );

  const linesJson = JSON.stringify(
    lines
      .filter((l) => l.item_id && Number(l.qty_sent) > 0)
      .map((l) => ({
        item_id: l.item_id,
        qty_sent: Number(l.qty_sent),
        rate: Number(l.rate) || 0,
      })),
  );

  const field =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const label = "flex flex-col gap-1 text-sm text-gray-600";

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="lines" value={linesJson} />

      {/* Header */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">Transfer details</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className={label}>
            From site *
            <select
              name="from_project_id"
              value={fromProjectId}
              onChange={(e) => setFromProjectId(e.target.value)}
              required
              className={field}
            >
              <option value="">Select…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            To site *
            <select name="to_project_id" required defaultValue="" className={field}>
              <option value="">Select…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Date
            <input
              type="date"
              name="transfer_date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={field}
            />
          </label>
          <label className={label}>
            Challan no.
            <input name="challan_no" className={field} placeholder="SGC/…/27" />
          </label>
          <label className={label}>
            Vehicle no.
            <input name="vehicle_no" className={field} placeholder="GJ 33 T 5158" />
          </label>
          <label className={label}>
            LR no.
            <input name="lr_no" className={field} />
          </label>
          <label className={label}>
            E-way bill no.
            <input name="eway_bill_no" className={field} />
          </label>
          <label className={label}>
            E-way bill date
            <input type="date" name="eway_bill_date" className={field} />
          </label>
          <label className={label}>
            Transporter
            <input name="transporter_name" className={field} />
          </label>
          <label className={`${label} sm:col-span-2 lg:col-span-3`}>
            Remarks
            <input name="remarks" className={field} />
          </label>
        </div>
      </section>

      {/* Line items */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Items</h2>
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, blankLine()])}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            + Add item
          </button>
        </div>

        <div className="space-y-3">
          <div className="hidden grid-cols-[1fr_7rem_7rem_8rem_2rem] gap-2 px-1 text-xs uppercase tracking-wide text-gray-400 sm:grid">
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Rate</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {lines.map((l) => {
            const amount = (Number(l.qty_sent) || 0) * (Number(l.rate) || 0);
            const onHand = l.item_id ? (stockMap.get(l.item_id) ?? null) : null;
            const item = l.item_id ? itemById.get(l.item_id) : undefined;
            const overDispatch =
              onHand !== null && Number(l.qty_sent) > 0 && Number(l.qty_sent) > onHand;
            return (
              <div key={l.key} className="space-y-1">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem_7rem_8rem_2rem] sm:items-center">
                  <select
                    value={l.item_id}
                    onChange={(e) => onItemChange(l.key, e.target.value)}
                    className={`${field} min-w-0`}
                  >
                    <option value="">Select item…</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} — {it.description}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={l.qty_sent}
                    onChange={(e) => updateLine(l.key, { qty_sent: e.target.value })}
                    placeholder="Qty"
                    className={`${field} min-w-0 text-right`}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={l.rate}
                    onChange={(e) => updateLine(l.key, { rate: e.target.value })}
                    placeholder="Rate"
                    className={`${field} min-w-0 text-right`}
                  />
                  <span className="px-1 text-right text-sm tabular-nums text-gray-600">
                    {amount.toLocaleString("en-IN")}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setLines((ls) =>
                        ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls,
                      )
                    }
                    className="text-gray-400 hover:text-red-600"
                    aria-label="Remove line"
                  >
                    ✕
                  </button>
                </div>

                {/* Stock hint — shown once an item is selected */}
                {l.item_id && (
                  <div className="pl-1 text-xs sm:col-span-5">
                    {stockLoading ? (
                      <span className="text-gray-400">Loading stock…</span>
                    ) : onHand === null ? (
                      <span className="text-gray-400">
                        {fromProjectId ? "No stock record" : "Select a from-site first"}
                      </span>
                    ) : (
                      <span className={onHand < 0 || overDispatch ? "font-medium text-blue-600" : "text-green-700"}>
                        Available:{" "}
                        {onHand.toLocaleString("en-IN")} {item?.unit ?? "NOS"}
                        {overDispatch && " — balance will go negative after this dispatch"}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end border-t border-gray-100 pt-3 text-sm">
          <span className="text-gray-500">Total&nbsp;</span>
          <span className="font-semibold tabular-nums">
            {total.toLocaleString("en-IN")}
          </span>
        </div>
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? "Dispatching…" : "Save & dispatch"}
        </button>
        <span className="text-xs text-gray-400">
          Dispatching removes the quantity from the source site as in-transit.
        </span>
      </div>
    </form>
  );
}
