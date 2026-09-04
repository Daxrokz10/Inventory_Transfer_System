"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* Categorical palette — fixed slot order (never cycled). More than six
   machines: we chart the six with the most data and say so, rather than
   inventing new hues. */
const SERIES = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
];

export interface EfficiencyPoint {
  machine_id: string;
  machine_label: string;
  /** Machine's registered type (e.g. "Car / Jeep", "DG Set") — drives the
      type filter tabs. Omit on single-machine views, where every point is
      already the same machine and a type filter has nothing to do. */
  machine_type?: string;
  entry_date: string;
  value: number;
  unit: "km/L" | "L/hr";
  /** True for a still-open fill (no later fill yet to close it out) — an
      estimate using the machine's current reading, that will firm up as
      more distance/hours accumulate before the next fill. */
  provisional?: boolean;
}

/** Legend entries as links to each machine's own page — `dataKey` is the
    machine_id we passed to each <Line>, so no extra lookup is needed. */
function LinkedLegend({ payload }: { payload?: { value: string; color?: string; dataKey?: string | number }[] }) {
  if (!payload || payload.length < 2) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2 text-xs">
      {payload.map((entry) => (
        <li key={String(entry.dataKey)} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          <Link
            href={`/diesel/machines/${entry.dataKey}`}
            className="text-ink-2 hover:text-accent hover:underline"
          >
            {entry.value}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Tooltip with each machine's name linked to its own page — same
    dataKey-as-machine_id trick as the legend above. */
function LinkedTooltip({
  active,
  label,
  payload,
  unit,
}: {
  active?: boolean;
  label?: string;
  payload?: { value?: number; color?: string; dataKey?: string | number; name?: string }[];
  unit: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-lg border p-2 text-xs"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-line)", color: "var(--color-ink)" }}
    >
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <Link
            href={`/diesel/machines/${entry.dataKey}`}
            className="text-ink-2 hover:text-accent hover:underline"
          >
            {entry.name}
          </Link>
          <span>: {entry.value} {unit}</span>
        </div>
      ))}
    </div>
  );
}

export function EfficiencyChart({ points }: { points: EfficiencyPoint[] }) {
  // Every type present, ranked by how many points it contributes — most
  // active type first, since that's the one worth seeing by default.
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of points) {
      if (!p.machine_type) continue;
      counts.set(p.machine_type, (counts.get(p.machine_type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [points]);
  const types = typeCounts.map(([t]) => t);

  const [selectedType, setSelectedType] = useState<string | null>(null);
  // Once types are known, default to the busiest one instead of lumping
  // every machine type onto a single "top 6" chart.
  const activeType = selectedType ?? types[0] ?? null;

  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-3">
        Not enough entries yet — efficiency needs at least two fill-ups per
        machine with meter readings.
      </p>
    );
  }

  const scoped =
    types.length > 1 && activeType != null
      ? points.filter((p) => p.machine_type === activeType)
      : points;

  // Rank machines by number of points; chart at most the top 6.
  const counts = new Map<string, number>();
  for (const p of scoped) {
    counts.set(p.machine_id, (counts.get(p.machine_id) ?? 0) + 1);
  }
  const machineIds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => id);
  const hidden = counts.size - machineIds.length;

  const labels = new Map(scoped.map((p) => [p.machine_id, p.machine_label]));
  const unit = scoped[0]?.unit ?? points[0].unit;

  const dates = [...new Set(scoped.map((p) => p.entry_date))].sort();
  const rows = dates.map((date) => {
    const row: Record<string, string | number> = { entry_date: date };
    for (const id of machineIds) {
      const match = scoped.find(
        (p) => p.machine_id === id && p.entry_date === date,
      );
      if (match) row[id] = Number(match.value.toFixed(2));
    }
    return row;
  });

  return (
    <div>
      {types.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSelectedType(t)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                t === activeType
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-strong text-ink-3 hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="entry_date"
            stroke="var(--color-line-strong)"
            tick={{ fill: "var(--color-ink-3)", fontSize: 12 }}
          />
          <YAxis
            stroke="var(--color-line-strong)"
            tick={{ fill: "var(--color-ink-3)", fontSize: 12 }}
            label={{
              value: unit,
              angle: -90,
              position: "insideLeft",
              fill: "var(--color-ink-3)",
              fontSize: 12,
            }}
          />
          <Tooltip content={<LinkedTooltip unit={unit} />} wrapperStyle={{ pointerEvents: "auto" }} />
          {machineIds.length > 1 && <Legend content={<LinkedLegend />} />}
          {machineIds.map((id, i) => (
            <Line
              key={id}
              type="monotone"
              dataKey={id}
              name={labels.get(id) ?? id}
              stroke={SERIES[i]}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 0, fill: SERIES[i] }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {hidden > 0 && (
        <p className="mt-1 text-xs text-ink-3">
          Showing the 6 {activeType ?? "machines"} with the most data ({hidden}{" "}
          more not charted — pick another type above to see them).
        </p>
      )}
    </div>
  );
}
