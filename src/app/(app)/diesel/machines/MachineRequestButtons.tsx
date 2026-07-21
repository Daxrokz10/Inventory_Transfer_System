"use client";

import { useState, useActionState } from "react";
import { requestMachineChange } from "./actions";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

// Supervisor-facing SO actions: request a renewal or a removal for a
// machine at their site. Both are requests — the admin acts on them.
// If an open request already exists, we show its status instead of the
// buttons.
export function MachineRequestButtons({
  machineId,
  ownership,
  pendingType,
}: {
  machineId: string;
  ownership: "internal" | "external";
  pendingType?: "renewal" | "removal" | null;
}) {
  const [open, setOpen] = useState<"renewal" | "removal" | null>(null);
  const [error, formAction, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await requestMachineChange(prev, fd);
      if (!result) setOpen(null);
      return result;
    },
    null,
  );

  if (pendingType) {
    return (
      <Badge tone="warn">
        {pendingType === "renewal" ? "Renewal" : "Removal"} requested · awaiting
        admin
      </Badge>
    );
  }

  if (open) {
    return (
      <form action={formAction} className="flex flex-col gap-1.5">
        <input type="hidden" name="machine_id" value={machineId} />
        <input type="hidden" name="type" value={open} />
        <p className="text-xs text-ink-2">
          {open === "renewal"
            ? "Ask the admin to extend this machine's SO."
            : ownership === "external"
              ? "Ask the admin to remove this hired machine — work done."
              : "Ask the admin to take this machine off site — work done."}
        </p>
        <input
          name="note"
          placeholder="Optional note for the admin"
          className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex items-center gap-1.5">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Sending…" : "Send request"}
          </Button>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="text-xs text-ink-3 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen("renewal")}
      >
        Request renewal
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen("removal")}
      >
        Request removal
      </Button>
    </div>
  );
}
