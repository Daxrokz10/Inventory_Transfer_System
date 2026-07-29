"use client";

import { useActionState } from "react";
import { createSiteGroup } from "./actions";

export function GroupForm() {
  const [error, action, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await createSiteGroup(prev, fd);
      if (!result) {
        (document.getElementById("new-group-form") as HTMLFormElement)?.reset();
      }
      return result;
    },
    null,
  );

  return (
    <form id="new-group-form" action={action} className="mb-2 flex items-end gap-2">
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        New group name
        <input
          name="name"
          required
          placeholder="e.g. Dahej cluster"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create group"}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
