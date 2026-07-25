import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardLabel } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import { StatusPill, NotMetered } from "@/components/ui/states";
import { soStatus, type Machine, type DailyLog, type AnomalyFlag } from "@/lib/diesel/types";
import { EfficiencyChart, type EfficiencyPoint } from "../../EfficiencyChart";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const SEVERITY_TONE: Record<string, "neutral" | "warn" | "danger"> = {
  low: "neutral",
  medium: "warn",
  high: "danger",
};

function dayMetric(machine: Machine, log: DailyLog): number | null {
  if (log.opening_reading == null || log.closing_reading == null) return null;
  const delta = Number(log.closing_reading) - Number(log.opening_reading);
  const fuel = Number(log.fuel_issued_liters);
  if (delta <= 0 || fuel <= 0) return null;
  return machine.reading_type === "hours" ? fuel / delta : delta / fuel;
}

export default async function MachineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";

  // RLS already scopes this to admin-any-site or supervisor-own-site — a
  // machine outside the caller's reach simply comes back null, same as a
  // genuinely missing id.
  const { data: machineRaw } = await supabase
    .from("machines")
    .select("*")
    .eq("id", id)
    .single();
  if (!machineRaw) notFound();
  const machine = machineRaw as Machine;

  const [{ data: project }, { data: logsRaw }] = await Promise.all([
    supabase.from("projects").select("id, name, code").eq("id", machine.project_id).single(),
    supabase
      .from("daily_logs")
      .select("*")
      .eq("machine_id", id)
      .order("log_date", { ascending: false })
      .limit(365),
  ]);

  const logs = (logsRaw ?? []) as DailyLog[];

  const { data: flagsRaw } = logs.length
    ? await supabase
        .from("anomaly_flags")
        .select("id, log_id, type, severity, message, resolved, created_at")
        .in("log_id", logs.map((l) => l.id))
        .order("created_at", { ascending: false })
    : { data: [] };
  const flags = (flagsRaw ?? []) as AnomalyFlag[];

  const unit = machine.reading_type === "hours" ? "hr" : "km";
  const so = soStatus(machine);

  // Efficiency history, oldest first for the chart.
  const pointUnit: "L/hr" | "km/L" = machine.reading_type === "hours" ? "L/hr" : "km/L";
  const points: EfficiencyPoint[] = logs
    .filter((l) => dayMetric(machine, l) != null)
    .map((l) => ({
      machine_id: machine.id,
      machine_label: machine.name,
      entry_date: l.log_date,
      value: dayMetric(machine, l)!,
      unit: pointUnit,
    }))
    .reverse();

  // Trending: last 7 fuel-days vs the 7 immediately before that — a quick
  // "is this getting worse" read, distinct from the formal 90-day
  // declining_trend anomaly (which needs much more history to fire).
  let trend: "up" | "down" | "flat" | null = null;
  if (points.length >= 6) {
    const recent = points.slice(-7);
    const prior = points.slice(-14, -7);
    if (prior.length >= 3) {
      const recentAvg = recent.reduce((s, p) => s + p.value, 0) / recent.length;
      const priorAvg = prior.reduce((s, p) => s + p.value, 0) / prior.length;
      const change = (recentAvg - priorAvg) / priorAvg;
      // For km/L, up = better; for L/hr, up = worse. Normalize so "up" in
      // the badge always means "better than before".
      const better = machine.reading_type === "hours" ? -change : change;
      trend = Math.abs(change) < 0.05 ? "flat" : better > 0 ? "up" : "down";
    }
  }

  const breakdowns = logs.filter((l) => l.status !== "normal");
  const totalFuel30 = logs
    .filter((l) => l.log_date >= new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10))
    .reduce((s, l) => s + Number(l.fuel_issued_liters), 0);

  // Fuel-source mix — how often this machine filled offsite (not from this
  // site's own stock) vs. its normal source (on-site stock, or Shraddha's
  // pump at those two sites).
  const fuelDays = logs.filter((l) => Number(l.fuel_issued_liters) > 0);
  const offsiteDays = fuelDays.filter((l) => l.fuel_source === "outside").length;
  const offsiteShare = fuelDays.length > 0 ? Math.round((offsiteDays / fuelDays.length) * 100) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={machine.name}
        subtitle={
          <>
            {project?.code ? `${project.code} · ` : ""}
            {project?.name ?? "—"} · {machine.machine_type}
            {machine.registration_no ? ` · ${machine.registration_no}` : ""}
          </>
        }
        actions={
          <a href="/diesel/machines" className="text-sm text-accent hover:underline">
            ← Back to Machinery
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardLabel>Current reading</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {machine.current_reading != null ? (
              <>
                {machine.current_reading} <span className="text-base text-ink-3">{unit}</span>
              </>
            ) : (
              <NotMetered label="—" />
            )}
          </p>
        </Card>
        <Card>
          <CardLabel>Fuel · 30 days</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {totalFuel30.toFixed(0)} L
          </p>
          {offsiteShare != null && offsiteShare > 0 && (
            <p className="mt-1 text-xs text-ink-3">
              {offsiteShare}% filled offsite ({offsiteDays}/{fuelDays.length})
            </p>
          )}
        </Card>
        <Card>
          <CardLabel>Status</CardLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!machine.is_active && <Badge tone="neutral">Inactive</Badge>}
            {machine.meter_broken && <StatusPill tone="alarm">Meter broken</StatusPill>}
            {so.state === "expired" && (
              <StatusPill tone="alarm">SO expired · {so.days}d over</StatusPill>
            )}
            {so.state === "soon" && <StatusPill tone="caution">SO ends in {so.days}d</StatusPill>}
            {machine.is_active && !machine.meter_broken && so.state !== "expired" && so.state !== "soon" && (
              <StatusPill tone="ok">Normal</StatusPill>
            )}
          </div>
        </Card>
        <Card>
          <CardLabel>Trend (last 2 weeks)</CardLabel>
          <p className="mt-2 text-lg font-semibold">
            {trend == null ? (
              <span className="text-ink-3">Not enough data</span>
            ) : trend === "up" ? (
              <span className="text-good">▲ Improving</span>
            ) : trend === "down" ? (
              <span className="text-danger">▼ Worsening</span>
            ) : (
              <span className="text-ink-2">— Steady</span>
            )}
          </p>
        </Card>
      </div>

      {points.length > 0 && (
        <Card>
          <CardLabel>
            Efficiency history — {machine.reading_type === "hours" ? "liters per hour" : "km per liter"}
          </CardLabel>
          <div className="mt-3">
            <EfficiencyChart points={points} />
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-sm font-semibold">Anomalies</h2>
          {flags.length > 0 && <Badge tone="warn">{flags.filter((f) => !f.resolved).length} open</Badge>}
        </div>
        {flags.length === 0 ? (
          <div className="px-5 pb-4">
            <EmptyState message="No anomalies flagged for this machine." />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {flags.slice(0, 30).map((f) => {
              const log = logs.find((l) => l.id === f.log_id);
              return (
                <li key={f.id} className="flex items-center gap-2.5 px-5 py-2.5 text-sm">
                  <Badge tone={SEVERITY_TONE[f.severity] ?? "warn"}>{f.severity}</Badge>
                  <span className="text-ink-2">
                    {log?.log_date ? `${log.log_date} — ` : ""}
                    {f.message}
                  </span>
                  {f.resolved && <Badge tone="good">Resolved</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-0">
        <h2 className="px-5 pt-4 text-sm font-semibold">
          Breakdowns &amp; maintenance history
        </h2>
        {breakdowns.length === 0 ? (
          <div className="px-5 pb-4">
            <EmptyState message="No breakdowns or maintenance days recorded." />
          </div>
        ) : (
          <Table className="mt-2">
            <thead>
              <tr>
                <TH>Date</TH>
                <TH>Status</TH>
                <TH>Remarks</TH>
              </tr>
            </thead>
            <tbody>
              {breakdowns.map((l) => (
                <TRow key={l.id}>
                  <TD className="whitespace-nowrap">{l.log_date}</TD>
                  <TD>
                    <StatusPill tone="caution">
                      {l.status === "breakdown" ? "Broken down" : "Under maintenance"}
                    </StatusPill>
                  </TD>
                  <TD className="text-ink-2">{l.remarks ?? "—"}</TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="overflow-x-auto p-0">
        <h2 className="px-5 pt-4 text-sm font-semibold">Daily report history</h2>
        <Table className="mt-2">
          <thead>
            <tr>
              <TH>Date</TH>
              <TH>Status</TH>
              <TH className="text-right">Opening</TH>
              <TH className="text-right">Closing</TH>
              <TH className="text-right">Fuel (L)</TH>
              <TH className="text-right">Mileage</TH>
              <TH className="text-right">Cost</TH>
              <TH>Remarks</TH>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <TD colSpan={8}>
                  <EmptyState message="No daily reports yet for this machine." />
                </TD>
              </tr>
            ) : (
              logs.slice(0, 100).map((l) => {
                const metric = dayMetric(machine, l);
                return (
                  <TRow key={l.id}>
                    <TD className="whitespace-nowrap">{l.log_date}</TD>
                    <TD>
                      {l.status === "normal" ? (
                        <StatusPill tone="ok">Reported</StatusPill>
                      ) : (
                        <StatusPill tone="caution">
                          {l.status === "breakdown" ? "Broken down" : "Under maintenance"}
                        </StatusPill>
                      )}
                    </TD>
                    <TD className="text-right font-mono tabular-nums">{l.opening_reading ?? "—"}</TD>
                    <TD className="text-right font-mono tabular-nums">{l.closing_reading ?? "—"}</TD>
                    <TD className="text-right font-mono tabular-nums">
                      {Number(l.fuel_issued_liters).toFixed(1)}
                      {l.fuel_source && l.fuel_source !== "on_site" && (
                        <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 font-sans text-[10px] uppercase tracking-wide text-ink-3">
                          {l.fuel_source === "shraddha" ? "Shraddha" : "offsite"}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right font-mono tabular-nums text-ink-2">
                      {metric != null ? `${metric.toFixed(2)} ${machine.reading_type === "hours" ? "L/hr" : "km/L"}` : "—"}
                    </TD>
                    <TD className="text-right font-mono tabular-nums">
                      {l.total_cost != null ? inr(Number(l.total_cost)) : "—"}
                    </TD>
                    <TD className="max-w-56 truncate text-ink-2">{l.remarks ?? "—"}</TD>
                  </TRow>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
