"use client";

import { useMemo, useState, useActionState } from "react";
import { saveDailySheet } from "./actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Field";
import { Table, TH, TRow, TD } from "@/components/ui/Table";
import { StatusPill } from "@/components/ui/states";
import type { DailyLog, Machine } from "@/lib/diesel/types";

/* One report per machine per day. A machine already reported for this
   date is locked — its row just shows what was submitted, no inputs, no
   resubmission. Opening is never typed in — it's always the machine's
   current_reading, carried forward automatically from whatever was last
   recorded (set once, when the machine was registered).

   A day can be marked breakdown/maintenance instead of a normal reading
   — no reading or fuel required, just the status and an optional note. */

type Status = "normal" | "breakdown" | "maintenance";

const STATUS_LABEL: Record<Status, string> = {
  normal: "Normal",
  breakdown: "Broken down",
  maintenance: "Under maintenance",
};

type FuelSource = "on_site" | "shraddha" | "outside";

interface RowState {
  status: Status;
  reading: string;
  fuel: string;
  source: FuelSource;
  remarks: string;
}

export function DailySheet({
  machines,
  existing,
  logDate,
  dieselPrice,
  petrolPrice,
  shraddhaPump = false,
}: {
  machines: Machine[];
  existing: Record<string, DailyLog>;
  logDate: string;
  dieselPrice: number | null;
  petrolPrice: number | null;
  /** True when this site fills at the sister company (Shraddha) pump —
      changes the source picker's options (Shraddha pump / Outside pump)
      instead of the default (On site / Offsite) shown everywhere else. */
  shraddhaPump?: boolean;
}) {
  const editable = useMemo(
    () => machines.filter((m) => !existing[m.id]),
    [machines, existing],
  );

  const initial = useMemo(() => {
    const map: Record<string, RowState> = {};
    for (const m of editable) {
      // Default source: Shraddha's pump at those two sites, this site's own
      // stock everywhere else — the site person only touches it to flag the
      // exception (a vehicle that went to fill outside).
      map[m.id] = {
        status: "normal",
        reading: "",
        fuel: "",
        source: shraddhaPump ? "shraddha" : "on_site",
        remarks: "",
      };
    }
    return map;
  }, [editable, shraddhaPump]);

  const [rows, setRows] = useState(initial);
  const [error, formAction, pending] = useActionState(saveDailySheet, null);

  const set = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const payload = editable.map((m) => {
    const r = rows[m.id];
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const normal = r.status === "normal";
    const fuel = normal && m.track_fuel ? Number(r.fuel) || 0 : 0;
    return {
      machine_id: m.id,
      status: r.status,
      closing_reading: normal && !m.meter_broken ? num(r.reading) : null,
      fuel_issued_liters: fuel,
      // Source tracked at every site now, only meaningful with fuel.
      fuel_source: fuel > 0 ? r.source : null,
      remarks: r.remarks.trim() || null,
    };
  });

  const addedFuelTotal = payload.reduce((s, r) => s + r.fuel_issued_liters, 0);
  const addedCostTotal = editable.reduce((s, m) => {
    if (rows[m.id]?.status !== "normal") return s;
    const fuel = Number(rows[m.id]?.fuel) || 0;
    const price = m.fuel_type === "petrol" ? petrolPrice : dieselPrice;
    return s + (price != null ? fuel * price : 0);
  }, 0);

  if (machines.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-2">
          No machinery registered at your site yet — add machines under{" "}
          <span className="font-medium">Machinery</span> first.
        </p>
      </Card>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="log_date" value={logDate} />
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />

      <Card className="overflow-x-auto p-0">
        <Table>
          <thead>
            <tr>
              <TH>Machine</TH>
              <TH className="w-40">Status</TH>
              <TH className="w-32 text-right">New reading</TH>
              <TH className="w-28 text-right">Fuel (L)</TH>
              <TH className="w-28 text-right">Est. cost</TH>
              <TH>Remarks</TH>
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => {
              const log = existing[m.id];
              const unit = m.reading_type === "hours" ? "hr" : "km";
              const price = m.fuel_type === "petrol" ? petrolPrice : dieselPrice;

              if (log) {
                return (
                  <TRow key={m.id} className="align-top bg-surface-2/40">
                    <TD>
                      <p className="flex flex-wrap items-center gap-1.5 font-medium">
                        {m.name}
                        <Badge
                          tone={m.ownership === "external" ? "warn" : "accent"}
                          className="px-1.5 py-0 text-[10px]"
                        >
                          {m.ownership === "external" ? "External" : "Internal"}
                        </Badge>
                      </p>
                      <p className="text-xs text-ink-3">
                        {m.machine_type}
                        {m.registration_no ? ` · ${m.registration_no}` : ""} ·{" "}
                        <span className="uppercase">{m.fuel_type}</span>
                      </p>
                    </TD>
                    <TD>
                      {log.status === "normal" ? (
                        <StatusPill tone="ok">Reported</StatusPill>
                      ) : (
                        <StatusPill tone="caution">
                          {STATUS_LABEL[log.status]}
                        </StatusPill>
                      )}
                    </TD>
                    <TD className="text-right font-mono tabular-nums text-ink-2">
                      {log.status === "normal"
                        ? `${log.opening_reading ?? "—"} → ${log.closing_reading ?? "—"} ${unit}`
                        : "—"}
                    </TD>
                    <TD className="text-right font-mono tabular-nums text-ink-2">
                      {Number(log.fuel_issued_liters).toFixed(1)}
                      {log.fuel_source && log.fuel_source !== "on_site" && (
                        <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 font-sans text-[10px] uppercase tracking-wide text-ink-3">
                          {log.fuel_source === "shraddha" ? "Shraddha" : "offsite"}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right font-mono tabular-nums text-ink-2">
                      {log.total_cost != null ? `₹${Number(log.total_cost).toFixed(0)}` : "—"}
                    </TD>
                    <TD className="text-ink-2">{log.remarks ?? "—"}</TD>
                  </TRow>
                );
              }

              const r = rows[m.id];
              const fuel = Number(r?.fuel) || 0;
              const normal = r.status === "normal";

              return (
                <TRow key={m.id} className="align-top">
                  <TD>
                    <p className="flex flex-wrap items-center gap-1.5 font-medium">
                      {m.name}
                      <Badge
                        tone={m.ownership === "external" ? "warn" : "accent"}
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {m.ownership === "external" ? "External" : "Internal"}
                      </Badge>
                    </p>
                    <p className="text-xs text-ink-3">
                      {m.machine_type}
                      {m.registration_no ? ` · ${m.registration_no}` : ""} ·{" "}
                      <span className="uppercase">{m.fuel_type}</span>
                    </p>
                  </TD>
                  <TD>
                    <Select
                      value={r.status}
                      onChange={(e) => set(m.id, { status: e.target.value as Status })}
                      className="text-xs"
                      aria-label={`${m.name} status`}
                    >
                      <option value="normal">Normal</option>
                      <option value="breakdown">Broken down</option>
                      <option value="maintenance">Under maintenance</option>
                    </Select>
                    {normal && !m.meter_broken && (
                      <p className="mt-1 text-[11px] text-ink-3">
                        {m.current_reading != null
                          ? `carried forward: ${m.current_reading} ${unit}`
                          : "no reading yet"}
                      </p>
                    )}
                  </TD>
                  <TD className="text-right">
                    {m.meter_broken ? (
                      <p className="text-xs font-medium text-danger">Meter broken</p>
                    ) : (
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        value={r.reading}
                        onChange={(e) => set(m.id, { reading: e.target.value })}
                        placeholder={
                          !normal
                            ? "n/a"
                            : m.current_reading != null
                              ? String(m.current_reading)
                              : undefined
                        }
                        disabled={!normal}
                        className="w-28 text-right"
                        aria-label={`${m.name} new reading`}
                      />
                    )}
                  </TD>
                  <TD className="text-right">
                    {m.track_fuel ? (
                      <div className="flex flex-col items-end gap-1">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={r.fuel}
                          onChange={(e) => set(m.id, { fuel: e.target.value })}
                          disabled={!normal}
                          className="w-24 text-right"
                          aria-label={`${m.name} fuel`}
                        />
                        {normal && fuel > 0 && (
                          <Select
                            value={r.source}
                            onChange={(e) =>
                              set(m.id, { source: e.target.value as FuelSource })
                            }
                            className="w-28 text-xs"
                            aria-label={`${m.name} fuel source`}
                          >
                            {shraddhaPump ? (
                              <>
                                <option value="shraddha">Shraddha pump</option>
                                <option value="outside">Outside pump</option>
                              </>
                            ) : (
                              <>
                                <option value="on_site">On site</option>
                                <option value="outside">Offsite</option>
                              </>
                            )}
                          </Select>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-ink-3">no fuel</span>
                    )}
                  </TD>
                  <TD className="pt-4 text-right tabular-nums text-ink-2">
                    {normal && fuel > 0 && price != null ? `₹${(fuel * price).toFixed(0)}` : "—"}
                  </TD>
                  <TD>
                    <Input
                      value={r.remarks}
                      onChange={(e) => set(m.id, { remarks: e.target.value })}
                      placeholder={normal ? "—" : "Reason (e.g. gearbox issue)"}
                      className="w-full"
                      aria-label={`${m.name} remarks`}
                    />
                  </TD>
                </TRow>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {editable.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
            Submitting:{" "}
            <span className="font-semibold text-ink">
              {addedFuelTotal.toFixed(1)} L
            </span>
            {addedCostTotal > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="font-semibold text-ink">
                  ₹{addedCostTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </span>
              </>
            )}
          </p>
          <div className="flex items-center gap-3">
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">
          Every machine has already been reported for this date.
        </p>
      )}
    </form>
  );
}
