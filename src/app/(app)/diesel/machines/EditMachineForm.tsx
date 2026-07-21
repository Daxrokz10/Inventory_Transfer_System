"use client";

import { useState, useActionState } from "react";
import { updateMachine } from "./actions";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { MACHINE_TYPES, type Machine } from "@/lib/diesel/types";
import { SoDurationField } from "./SoDurationField";

// Admin inline editor for a single machine. Opens from the Machinery
// row's "Edit" button; site is not editable here (use "Transfer site").
export function EditMachineForm({
  machine,
  onDone,
}: {
  machine: Machine;
  onDone: () => void;
}) {
  const [ownership, setOwnership] = useState(machine.ownership);
  const [trackFuel, setTrackFuel] = useState(machine.track_fuel);
  const [readingType, setReadingType] = useState(machine.reading_type);
  const [error, formAction, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await updateMachine(prev, fd);
      if (!result) onDone();
      return result;
    },
    null,
  );

  const typeOptions = MACHINE_TYPES.includes(
    machine.machine_type as (typeof MACHINE_TYPES)[number],
  )
    ? MACHINE_TYPES
    : [machine.machine_type, ...MACHINE_TYPES];

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
      <input type="hidden" name="machine_id" value={machine.id} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Machine name">
          <Input name="name" required defaultValue={machine.name} />
        </Field>
        <Field label="Machine type">
          <Select name="machine_type" required defaultValue={machine.machine_type}>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Numberplate">
          <Input name="registration_no" defaultValue={machine.registration_no ?? ""} />
        </Field>
        <Field label="Metered by">
          <Select
            name="reading_type"
            required
            value={readingType}
            onChange={(e) => setReadingType(e.target.value as "km" | "hours")}
          >
            <option value="km">Odometer (km)</option>
            <option value="hours">Running hours</option>
          </Select>
        </Field>
        <Field label="Fuel">
          <Select name="fuel_type" required defaultValue={machine.fuel_type}>
            <option value="diesel">Diesel</option>
            <option value="petrol">Petrol</option>
          </Select>
        </Field>
        <Field label="Ownership">
          <Select
            name="ownership"
            required
            value={ownership}
            onChange={(e) => setOwnership(e.target.value as "internal" | "external")}
          >
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </Select>
        </Field>
        {ownership === "external" && (
          <Field label="Vendor name">
            <Input name="vendor_name" required defaultValue={machine.vendor_name ?? ""} />
          </Field>
        )}
        {trackFuel && (
          <Field
            label={readingType === "hours" ? "Current reading (hours)" : "Current reading (km)"}
            hint="Leave blank to keep the current value"
          >
            <Input
              name="current_reading"
              type="number"
              step="0.1"
              min="0"
              defaultValue={machine.current_reading ?? ""}
            />
          </Field>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          name="track_fuel"
          checked={trackFuel}
          onChange={(e) => setTrackFuel(e.target.checked)}
        />
        Track this machine&apos;s fuel on the daily report
      </label>

      <SoDurationField defaultUntil={machine.so_until} />

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
