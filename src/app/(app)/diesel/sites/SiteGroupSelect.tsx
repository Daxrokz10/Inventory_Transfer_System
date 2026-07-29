"use client";

import { useState, useTransition } from "react";
import { setSiteGroup } from "./actions";

// A plain server-rendered <select defaultValue={...}> is uncontrolled —
// saving ANY row on this page triggers a revalidatePath refresh of the
// whole Sites page, and that refresh can reset a DIFFERENT row's
// not-yet-saved dropdown selection back to its server value before the
// user gets to click Save on it. Keeping this row's value in local React
// state (initialized once, untouched by parent re-renders since the
// component instance stays mounted) makes it immune to that.
export function SiteGroupSelect({
  projectId,
  groupId,
  groups,
}: {
  projectId: string;
  groupId: string | null;
  groups: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(groupId ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs"
      >
        <option value="">Ungrouped</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set("project_id", projectId);
          fd.set("group_id", value);
          startTransition(() => {
            setSiteGroup(fd);
          });
        }}
        className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
