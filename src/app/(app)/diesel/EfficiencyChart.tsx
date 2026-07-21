"use client";

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
  entry_date: string;
  value: number;
  unit: "km/L" | "L/hr";
}

export function EfficiencyChart({ points }: { points: EfficiencyPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-3">
        Not enough entries yet — efficiency needs at least two fill-ups per
        machine with meter readings.
      </p>
    );
  }

  // Rank machines by number of points; chart at most the top 6.
  const counts = new Map<string, number>();
  for (const p of points) {
    counts.set(p.machine_id, (counts.get(p.machine_id) ?? 0) + 1);
  }
  const machineIds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => id);
  const hidden = counts.size - machineIds.length;

  const labels = new Map(points.map((p) => [p.machine_id, p.machine_label]));
  const unit = points[0].unit;

  const dates = [...new Set(points.map((p) => p.entry_date))].sort();
  const rows = dates.map((date) => {
    const row: Record<string, string | number> = { entry_date: date };
    for (const id of machineIds) {
      const match = points.find(
        (p) => p.machine_id === id && p.entry_date === date,
      );
      if (match) row[id] = Number(match.value.toFixed(2));
    }
    return row;
  });

  return (
    <div>
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
          <Tooltip
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 8,
              color: "var(--color-ink)",
              fontSize: 12,
            }}
          />
          {machineIds.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
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
          Showing the 6 machines with the most data ({hidden} more not charted —
          filter by machine to see them).
        </p>
      )}
    </div>
  );
}
