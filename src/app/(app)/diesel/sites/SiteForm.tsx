"use client";

import { useActionState } from "react";
import { createSite } from "./actions";
import { INDIAN_STATES } from "@/lib/diesel/types";

const field =
  "rounded-lg border border-line-strong px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent w-full";
const label = "flex flex-col gap-1 text-sm text-ink-2";

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
          Address <span className="text-ink-3">(optional)</span>
          <input name="address" className={field} />
        </label>
        <label className={label}>
          State <span className="text-ink-3">(for daily fuel prices)</span>
          <select name="state" className={field} defaultValue="">
            <option value="">Not set</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          GSTIN <span className="text-ink-3">(optional)</span>
          <input name="gstin" className={field} />
        </label>
        <label className={label}>
          Branch <span className="text-ink-3">(optional)</span>
          <input name="branch" className={field} placeholder="NAVSARI" />
        </label>
        <label className={label}>
          Transporter <span className="text-ink-3">(optional)</span>
          <input name="transporter_name" className={field} />
        </label>
      </div>
      {error && (
        <p className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger">{error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Saving…" : "Add site"}
      </button>
    </form>
  );
}
