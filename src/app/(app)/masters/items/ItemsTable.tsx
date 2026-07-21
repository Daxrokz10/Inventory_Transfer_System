"use client";

import { useActionState, useState } from "react";
import { updateItem, deleteItem } from "./actions";

export type ItemRowData = {
  id: string;
  code: string;
  description: string;
  unit: string | null;
  sub_group: string | null;
  main_group: string | null;
  hsn_code: string | null;
  per_day_rate: number;
  total: number;
};

const qtyFmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

const cell = "px-3 py-2 align-top";
const headCell = "px-3 py-2 whitespace-nowrap";
const input =
  "w-full rounded border border-line-strong px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export function ItemsTable({
  items,
  isAdmin,
}: {
  items: ItemRowData[];
  isAdmin: boolean;
}) {
  const colCount = isAdmin ? 9 : 8;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
          <th className={headCell}>Code</th>
          <th className={headCell}>Description</th>
          <th className={headCell}>Unit</th>
          <th className={headCell}>Sub group</th>
          <th className={headCell}>Main group</th>
          <th className={headCell}>HSN</th>
          <th className={`${headCell} text-right`}>Rate</th>
          <th className={`${headCell} text-right`}>Total qty (all sites)</th>
          {isAdmin && <th className={`${headCell} text-right`}>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <ItemRow key={it.id} item={it} isAdmin={isAdmin} colCount={colCount} />
        ))}
      </tbody>
    </table>
  );
}

function ItemRow({
  item,
  isAdmin,
  colCount,
}: {
  item: ItemRowData;
  isAdmin: boolean;
  colCount: number;
}) {
  const [editing, setEditing] = useState(false);

  const [updateErr, updateAction, updating] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const res = await updateItem(prev, fd);
      if (!res) setEditing(false);
      return res;
    },
    null,
  );
  const [deleteErr, deleteAction, deleting] = useActionState(deleteItem, null);

  if (!editing) {
    return (
      <tr className="border-b border-line hover:bg-surface-2">
        <td className={`${cell} font-medium`}>{item.code}</td>
        <td className={cell}>{item.description}</td>
        <td className={cell}>{item.unit}</td>
        <td className={cell}>{item.sub_group}</td>
        <td className={cell}>{item.main_group}</td>
        <td className={cell}>{item.hsn_code}</td>
        <td className={`${cell} text-right tabular-nums`}>
          {Number(item.per_day_rate ?? 0).toLocaleString("en-IN")}
        </td>
        <td
          className={`${cell} text-right font-medium tabular-nums ${
            item.total < 0 ? "text-danger" : "text-ink"
          }`}
        >
          {qtyFmt(item.total)}
        </td>
        {isAdmin && (
          <td className={`${cell} text-right`}>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs font-medium text-accent hover:underline"
              >
                Edit
              </button>
              <form
                action={deleteAction}
                onSubmit={(e) => {
                  if (!confirm(`Delete item ${item.code}? This cannot be undone.`)) e.preventDefault();
                }}
                className="inline"
              >
                <input type="hidden" name="id" value={item.id} />
                <button
                  type="submit"
                  disabled={deleting}
                  className="text-xs font-medium text-danger hover:underline disabled:opacity-60"
                >
                  {deleting ? "…" : "Delete"}
                </button>
              </form>
            </div>
            {deleteErr && (
              <p className="mt-1 text-xs text-danger">{deleteErr}</p>
            )}
          </td>
        )}
      </tr>
    );
  }

  // Editing: one form spanning the row (placed inside a single cell so the
  // markup stays valid, laid out as a grid).
  return (
    <tr className="border-b border-line bg-accent-soft/40">
      <td className={cell} colSpan={colCount}>
        <form action={updateAction} className="space-y-3">
          <input type="hidden" name="id" value={item.id} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-ink-2">
              Code
              <input name="code" defaultValue={item.code} required className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-2 lg:col-span-3">
              Description
              <input name="description" defaultValue={item.description} required className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-2">
              Unit
              <input name="unit" defaultValue={item.unit ?? "NOS"} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-2">
              Sub group
              <input name="sub_group" defaultValue={item.sub_group ?? ""} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-2">
              Main group
              <input name="main_group" defaultValue={item.main_group ?? ""} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-2">
              HSN code
              <input name="hsn_code" defaultValue={item.hsn_code ?? ""} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-2">
              Rate
              <input
                name="per_day_rate"
                type="number"
                min="0"
                step="any"
                defaultValue={Number(item.per_day_rate ?? 0)}
                className={input}
              />
            </label>
          </div>
          {updateErr && (
            <p className="rounded bg-danger-soft px-3 py-1.5 text-xs text-danger">{updateErr}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={updating}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-60"
            >
              {updating ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-line-strong px-4 py-1.5 text-sm font-medium text-ink-2 hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}
