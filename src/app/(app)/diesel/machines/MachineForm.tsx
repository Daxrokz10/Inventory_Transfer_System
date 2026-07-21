"use client";

import { useState, useActionState } from "react";
import { addMachine } from "./actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { MACHINE_TYPES } from "@/lib/diesel/types";
import { SoDurationField } from "./SoDurationField";

export function NewMachineButton({
  sites,
  homeProjectId,
  isAdmin,
}: {
  sites: { id: string; name: string }[];
  homeProjectId: string | null;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Supervisors can only register hired (external) machines; internal
  // (company-owned) machinery is admin-only, so lock them to external.
  const [ownership, setOwnership] = useState<"internal" | "external">(
    isAdmin ? "internal" : "external",
  );
  const [readingType, setReadingType] = useState<"km" | "hours">("km");
  const [trackFuel, setTrackFuel] = useState(true);
  const [error, formAction, pending] = useActionState(addMachine, null);

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Add machine</Button>;
  }

  return (
    <Card>
      <form action={formAction} className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Register a machine</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-ink-3 hover:text-ink"
          >
            Cancel
          </button>
        </div>

        {/* Internal / external segmented toggle — admin only. Supervisors
            are locked to external (hired) machines. */}
        {isAdmin ? (
          <div className="grid max-w-xs grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
            {(["internal", "external"] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOwnership(o)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                  ownership === o
                    ? "bg-accent text-white"
                    : "text-ink-2 hover:text-ink",
                )}
              >
                {o}
              </button>
            ))}
          </div>
        ) : null}
        <input type="hidden" name="ownership" value={ownership} />
        <p className="text-xs text-ink-3">
          {ownership === "internal"
            ? "Company-owned machinery."
            : isAdmin
              ? "Hired / rented machinery — vendor name is required."
              : "You can register hired (external) machines. Company-owned machinery is added by an admin."}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {isAdmin ? (
            <Field label="Site">
              <Select name="project_id" required defaultValue="">
                <option value="" disabled>
                  Select site…
                </option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="project_id" value={homeProjectId ?? ""} />
          )}
          <Field label="Machine name">
            <Input name="name" required placeholder="e.g. JCB 3DX" />
          </Field>
          <Field label="Machine type">
            <Select name="machine_type" required defaultValue="">
              <option value="" disabled>
                Select type…
              </option>
              {MACHINE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Numberplate" hint="Leave blank for DG sets etc.">
            <Input name="registration_no" placeholder="GJ-21-AB-1234" />
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
            <Select name="fuel_type" required defaultValue="diesel">
              <option value="diesel">Diesel</option>
              <option value="petrol">Petrol</option>
            </Select>
          </Field>
          {trackFuel && (
            <Field
              label={readingType === "hours" ? "Starting reading (hours)" : "Starting reading (km)"}
              hint={
                readingType === "hours"
                  ? "Current lifetime hour-meter reading — the only time this is typed in; every daily report after this carries it forward automatically"
                  : "Current odometer reading (km) — the only time this is typed in; every daily report after this carries it forward automatically"
              }
            >
              <Input
                name="current_reading"
                type="number"
                step="0.1"
                min="0"
                required
                defaultValue="0"
                placeholder={readingType === "hours" ? "e.g. 4500 hours" : "e.g. 32000 km"}
              />
            </Field>
          )}
          <Field label="Tank capacity (L)" hint="Optional — enables over-fill checks">
            <Input name="tank_capacity_liters" type="number" step="0.1" min="0" />
          </Field>
          {ownership === "external" && (
            <Field label="Vendor name">
              <Input name="vendor_name" required placeholder="Hiring vendor" />
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
          <span className="text-ink-3">
            (uncheck for electric/no-engine items and office vehicles)
          </span>
        </label>

        <SoDurationField />

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save machine"}
        </Button>
      </form>
    </Card>
  );
}
