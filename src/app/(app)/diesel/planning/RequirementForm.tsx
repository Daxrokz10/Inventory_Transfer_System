"use client";

import { useState, useActionState } from "react";
import { addRequirement } from "./actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { MACHINE_TYPES } from "@/lib/diesel/types";
import { COSTED_MACHINE_TYPES } from "@/lib/diesel/planning";

// Admin-only: file an upcoming requirement — a site, a machine type, how
// many, and the window it's needed for. Left open-ended ("needed_until"
// blank) if the need has no defined end date yet.
export function RequirementForm({
  sites,
}: {
  sites: { id: string; name: string; code: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await addRequirement(prev, fd);
      if (!result) setOpen(false);
      return result;
    },
    null,
  );

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Add requirement</Button>;
  }

  const otherTypes = MACHINE_TYPES.filter((t) => !COSTED_MACHINE_TYPES.includes(t));

  return (
    <Card>
      <form action={formAction} className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
            New requirement
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-ink-3 hover:text-ink"
          >
            Cancel
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Site">
            <Select name="project_id" required defaultValue="">
              <option value="" disabled>
                Select site…
              </option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code ? `${s.code} · ` : ""}
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Machine type" hint="Costed types show a rent/buy verdict">
            <Select name="machine_type" required defaultValue="">
              <option value="" disabled>
                Select type…
              </option>
              <optgroup label="Cost data available">
                {COSTED_MACHINE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Other types">
                {otherTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="Quantity">
            <Input name="quantity" type="number" min="1" step="1" defaultValue="1" required />
          </Field>
          <Field label="Needed from">
            <Input name="needed_from" type="date" required />
          </Field>
          <Field label="Needed until" hint="Leave blank if open-ended / ongoing">
            <Input name="needed_until" type="date" />
          </Field>
        </div>

        <Field label="Note" hint="Optional — context for whoever plans this">
          <Textarea name="note" rows={2} />
        </Field>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save requirement"}
        </Button>
      </form>
    </Card>
  );
}
