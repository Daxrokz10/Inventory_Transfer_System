"use client";

import { useActionState } from "react";
import { createSite } from "./actions";

const field =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full";
const label = "flex flex-col gap-1 text-sm text-gray-600";

export function SiteForm() {
  const [error, action, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await createSite(prev, fd);
      if (!result) {
        (document.getElementById("new-site-form") as HTMLFormElement)?.reset();
      }
      return result;
    },
    null,
  );

  return (
    <form id="new-site-form" action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className={label}>
          Code *
          <input name="code" required className={field} placeholder="J-0096" />
        </label>
        <label className={`${label} lg:col-span-2`}>
          Name *
          <input name="name" required className={field} placeholder="RAJKOT DAIRY Project" />
        </label>
        <label className={`${label} sm:col-span-2 lg:col-span-3`}>
          Address <span className="text-gray-400">(optional)</span>
          <input name="address" className={field} />
        </label>
        <label className={label}>
          GSTIN <span className="text-gray-400">(optional)</span>
          <input name="gstin" className={field} />
        </label>
        <label className={label}>
          Branch <span className="text-gray-400">(optional)</span>
          <input name="branch" className={field} placeholder="NAVSARI" />
        </label>
        <label className={label}>
          Transporter <span className="text-gray-400">(optional)</span>
          <input name="transporter_name" className={field} />
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
        {pending ? "Saving…" : "Add site"}
      </button>
    </form>
  );
}
