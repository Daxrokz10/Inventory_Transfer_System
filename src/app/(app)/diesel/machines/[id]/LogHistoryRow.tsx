"use client";

import { useState, useTransition } from "react";
import { editDailyLog } from "./actions";
import { TD, TRow } from "@/components/ui/Table";
import { StatusPill } from "@/components/ui/states";
import type { DailyLog } from "@/lib/diesel/types";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

interface Metric {
  value: number;
  unit: string;
  provisional?: boolean;
}

// Double-clicking the date cell reveals an inline editor — no button, no
// icon, nothing in the layout hints it's there. `canEdit` is resolved
// server-side per the caller's own account, so the double-click does
// nothing at all for anyone else; the server action re-checks anyway.
export function LogHistoryRow({
  log,
  metric,
  canEdit,
}: {
  log: DailyLog;
  metric: Metric | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(String(log.opening_reading ?? ""));
  const [closing, setClosing] = useState(String(log.closing_reading ?? ""));
  const [fuel, setFuel] = useState(String(log.fuel_issued_liters ?? 0));
  const [remarks, setRemarks] = useState(log.remarks ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <TRow>
        <TD
          className="whitespace-nowrap"
          onDoubleClick={canEdit ? () => setEditing(true) : undefined}
        >
          {log.log_date}
        </TD>
        <TD>
          {log.status === "normal" ? (
            <StatusPill tone="ok">Reported</StatusPill>
          ) : (
            <StatusPill tone="caution">
              {log.status === "breakdown" ? "Broken down" : "Under maintenance"}
            </StatusPill>
          )}
        </TD>
        <TD className="text-right font-mono tabular-nums">{log.opening_reading ?? "—"}</TD>
        <TD className="text-right font-mono tabular-nums">{log.closing_reading ?? "—"}</TD>
        <TD className="text-right font-mono tabular-nums">
          {Number(log.fuel_issued_liters).toFixed(1)}
          {log.fuel_source && log.fuel_source !== "on_site" && (
            <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 font-sans text-[10px] uppercase tracking-wide text-ink-3">
              {log.fuel_source === "shraddha" ? "Shraddha" : "offsite"}
            </span>
          )}
        </TD>
        <TD className="text-right font-mono tabular-nums text-ink-2">
          {metric ? (
            <>
              {metric.value.toFixed(2)} {metric.unit}
              {metric.provisional && (
                <span
                  className="ml-1 text-[10px] text-ink-3"
                  title="No later fill yet to close this one out — estimate using the current reading"
                >
                  so far
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </TD>
        <TD className="text-right font-mono tabular-nums">
          {log.total_cost != null ? inr(Number(log.total_cost)) : "—"}
        </TD>
        <TD className="max-w-56 truncate text-ink-2">{log.remarks ?? "—"}</TD>
      </TRow>
    );
  }

  return (
    <TRow className="bg-surface-2/60">
      <TD className="whitespace-nowrap text-ink-3">{log.log_date}</TD>
      <TD colSpan={7}>
        <div className="flex flex-wrap items-center gap-2 py-1">
          <input
            className="w-24 rounded border border-line bg-surface px-1.5 py-1 text-right font-mono text-xs"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            placeholder="opening"
          />
          <span className="text-ink-3">→</span>
          <input
            className="w-24 rounded border border-line bg-surface px-1.5 py-1 text-right font-mono text-xs"
            value={closing}
            onChange={(e) => setClosing(e.target.value)}
            placeholder="closing"
          />
          <input
            className="w-20 rounded border border-line bg-surface px-1.5 py-1 text-right font-mono text-xs"
            value={fuel}
            onChange={(e) => setFuel(e.target.value)}
            placeholder="fuel L"
          />
          <input
            className="min-w-32 flex-1 rounded border border-line bg-surface px-1.5 py-1 text-xs"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="remarks"
          />
          <button
            type="button"
            disabled={pending}
            className="rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            onClick={() =>
              startTransition(async () => {
                const res = await editDailyLog({
                  log_id: log.id,
                  opening_reading: opening.trim() === "" ? null : Number(opening),
                  closing_reading: closing.trim() === "" ? null : Number(closing),
                  fuel_issued_liters: Number(fuel) || 0,
                  remarks: remarks.trim() || null,
                });
                if (res) setError(res);
                else setEditing(false);
              })
            }
          >
            {pending ? "…" : "Save"}
          </button>
          <button
            type="button"
            className="text-xs text-ink-3 hover:text-ink"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      </TD>
    </TRow>
  );
}
