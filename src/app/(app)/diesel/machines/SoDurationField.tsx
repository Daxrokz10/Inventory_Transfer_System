"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/Field";

// SO (Supply Order) / on-site deadline. A single expiry date — no
// duration helper. Leave it off for permanent machines with no deadline.
// The date is submitted as the hidden field `so_until` (empty = no
// deadline).
export function SoDurationField({
  defaultUntil,
}: {
  defaultUntil?: string | null;
}) {
  const [enabled, setEnabled] = useState(!!defaultUntil);
  const [until, setUntil] = useState(defaultUntil ?? "");

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Set an SO / on-site expiry date for this machine
      </label>

      {enabled && (
        <div className="mt-3">
          <Field
            label="SO expires on"
            hint="The date this machine's authorization to stay at the site runs out"
          >
            <Input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Field>
        </div>
      )}

      {/* Empty value = no deadline (permanent). */}
      <input type="hidden" name="so_until" value={enabled ? until : ""} />
    </div>
  );
}
