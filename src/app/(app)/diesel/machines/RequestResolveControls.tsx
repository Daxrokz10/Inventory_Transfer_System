"use client";

import { resolveMachineRequest } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

// Admin controls to act on a pending machine request. Renewal approvals
// require the admin to type the new SO date; removal approvals confirm
// first (external machines are deleted outright).
export function RequestResolveControls({
  requestId,
  type,
  ownership,
}: {
  requestId: string;
  type: "renewal" | "removal";
  ownership: "internal" | "external";
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-wrap items-end gap-3">
      {type === "renewal" ? (
        <form action={resolveMachineRequest} className="flex items-end gap-2">
          <input type="hidden" name="request_id" value={requestId} />
          <input type="hidden" name="decision" value="approve" />
          <label className="text-xs text-ink-2">
            New SO date
            <Input
              type="date"
              name="so_until"
              required
              min={today}
              className="mt-0.5 block"
            />
          </label>
          <Button type="submit" size="sm">
            Approve &amp; renew
          </Button>
        </form>
      ) : (
        <form
          action={resolveMachineRequest}
          onSubmit={(e) => {
            const msg =
              ownership === "external"
                ? "Approve removal? This hired machine and its history will be permanently deleted."
                : "Approve removal? This machine will be deactivated (history kept).";
            if (!window.confirm(msg)) e.preventDefault();
          }}
        >
          <input type="hidden" name="request_id" value={requestId} />
          <input type="hidden" name="decision" value="approve" />
          <Button type="submit" size="sm" variant="danger">
            Approve removal
          </Button>
        </form>
      )}

      <form action={resolveMachineRequest}>
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="decision" value="reject" />
        <Button type="submit" size="sm" variant="secondary">
          Reject
        </Button>
      </form>
    </div>
  );
}
