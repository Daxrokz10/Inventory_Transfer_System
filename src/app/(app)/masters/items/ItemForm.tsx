"use client";

import { useActionState, useState } from "react";
import { createItem } from "./actions";

const field =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full";
const label = "flex flex-col gap-1 text-sm text-gray-600";

export function NewItemButton() {
  const [open, setOpen] = useState(false);
  const [error, action, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await createItem(prev, fd);
      if (!result) {
        (document.getElementById("new-item-form") as HTMLFormElement)?.reset();
        setOpen(false);
      }
      return result;
    },
    null,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
      >
        + New item
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">New item</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
      <form id="new-item-form" action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className={label}>
            Code *
            <input name="code" required className={field} placeholder="SGC-117" />
          </label>
          <label className={`${label} lg:col-span-2`}>
            Description *
            <input name="description" required className={field} placeholder="M.S CHANNEL-100MM 20'" />
          </label>
          <label className={label}>
            Unit
            <input name="unit" className={field} placeholder="NOS" defaultValue="NOS" />
          </label>
          <label className={label}>
            Sub group <span className="text-gray-400">(optional)</span>
            <input name="sub_group" className={field} placeholder="CHANNEL" />
          </label>
          <label className={label}>
            Main group <span className="text-gray-400">(optional)</span>
            <input name="main_group" className={field} placeholder="SHUTTERING MATERIAL" />
          </label>
          <label className={label}>
            HSN code <span className="text-gray-400">(optional)</span>
            <input name="hsn_code" className={field} />
          </label>
          <label className={label}>
            Rate <span className="text-gray-400">(optional)</span>
            <input name="per_day_rate" type="number" min="0" step="any" className={field} defaultValue="0" />
          </label>
        </div>
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save item"}
        </button>
      </form>
    </div>
  );
}
