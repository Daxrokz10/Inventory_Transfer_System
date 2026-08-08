"use client";

import { useActionState } from "react";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { generateNarrative, type NarrativeState } from "./actions";

/* "AI Summary" card on the Diesel Report page.

   Generated on click, never on page load: the model runs on a PC at home
   behind a tunnel, so a render-time call would make this page hang whenever
   that machine is asleep. Collapsed to a single button until asked.

   Nothing here is persisted — regenerating is free and the date-range key
   space is too large for a cache to earn its keep. */
export function AiSummary({
  start,
  end,
  site,
}: {
  start: string;
  end: string;
  site: string | null;
}) {
  const [state, formAction, pending] = useActionState<NarrativeState, FormData>(
    generateNarrative,
    { status: "idle" },
  );

  // A summary written for a different range than the one now selected is
  // stale and would be read as if it described the current filter.
  const stale =
    state.status === "done" && (state.start !== start || state.end !== end);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardLabel>Written summary</CardLabel>
          <p className="mt-1 text-sm text-ink-2">
            A briefing on this date range, written by the local assistant from
            the same figures shown below.
          </p>
        </div>
        <form action={formAction}>
          <input type="hidden" name="start" value={start} />
          <input type="hidden" name="end" value={end} />
          <input type="hidden" name="site" value={site ?? ""} />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending
              ? "Writing…"
              : state.status === "done"
                ? "Regenerate"
                : "Generate summary"}
          </Button>
        </form>
      </div>

      {state.status === "error" && (
        <p className="mt-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
          {state.error}
        </p>
      )}

      {state.status === "done" && (
        <div className="mt-4 border-t border-line pt-4">
          {stale && (
            <p className="mb-3 text-xs text-warn">
              This summary describes {state.start} to {state.end}, not the range
              currently selected — regenerate to update it.
            </p>
          )}
          {/* Model output is rendered as plain text, never as markup. */}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {state.text}
          </div>
          <p className="mt-3 text-xs text-ink-3">
            Written by the local assistant from the table below. Check any
            figure you plan to act on against that table.
          </p>
        </div>
      )}
    </Card>
  );
}
