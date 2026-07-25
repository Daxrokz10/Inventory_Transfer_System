"use client";

import { removeHiredMachine } from "./actions";

// Site-person control to retire a hired (external) machine when its hire
// ends. Deactivates it (history kept), with a confirm gate.
export function RemoveHiredMachineButton({
  machineId,
  machineName,
}: {
  machineId: string;
  machineName: string;
}) {
  return (
    <form
      action={removeHiredMachine}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Remove ${machineName}? It’ll come off the daily report. Its diesel history is kept.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="machine_id" value={machineId} />
      <button
        type="submit"
        className="text-xs text-ink-3 underline decoration-dotted underline-offset-2 hover:text-danger"
      >
        Remove
      </button>
    </form>
  );
}
