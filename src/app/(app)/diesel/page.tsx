import { Fragment } from "react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardLabel } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import type { DailyLog, Machine, FuelReceipt } from "@/lib/diesel/types";
import { getPricesForCity } from "@/lib/diesel/fuelPrice";
import { computeFillMetrics } from "@/lib/diesel/efficiency";
import { cityForState, soStatus } from "@/lib/diesel/types";
import { DailySheet } from "./DailySheet";
import { FuelReceiptForm } from "./FuelReceiptForm";
import { MachineRequestButtons } from "./machines/MachineRequestButtons";
import { RequestResolveControls } from "./machines/RequestResolveControls";
import { EfficiencyChart, type EfficiencyPoint } from "./EfficiencyChart";
import { resolveFlag, deleteFuelReceipt } from "./actions";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const SEVERITY_TONE: Record<string, BadgeTone> = {
  low: "neutral",
  medium: "warn",
  high: "danger",
};

// Each fill's fuel is attributed to the full distance/hours it covered
// through the NEXT fill (see efficiency.ts) — a tank topped up today
// might run the machine for several more days, so this measures the
// whole stretch it powered, not just today's own movement. The most
// recent fill (no next one yet) still gets a point, marked provisional,
// using the machine's current reading as a running "so far" estimate.
function efficiencyPoints(
  machines: Machine[],
  logs: DailyLog[],
): EfficiencyPoint[] {
  const logsByMachine = new Map<string, DailyLog[]>();
  for (const log of logs) {
    (logsByMachine.get(log.machine_id) ?? logsByMachine.set(log.machine_id, []).get(log.machine_id)!).push(
      log,
    );
  }
  const points: EfficiencyPoint[] = [];
  for (const m of machines) {
    const machineLogs = logsByMachine.get(m.id);
    if (!machineLogs) continue;
    for (const fm of computeFillMetrics(m, machineLogs, m.current_reading)) {
      if (!fm.plausible) continue;
      points.push({
        machine_id: m.id,
        machine_label: m.name,
        entry_date: fm.log_date,
        value: fm.value,
        unit: fm.unit,
        provisional: fm.provisional,
      });
    }
  }
  return points;
}

function PriceBanner({
  city,
  diesel,
  petrol,
  source,
  priceDate,
}: {
  city: string | null;
  diesel: number | null;
  petrol: number | null;
  source: string;
  priceDate: string | null;
}) {
  if (!city) {
    return (
      <Card className="border-warn/30 bg-warn-soft">
        <p className="text-sm text-warn">
          This site has no city set — ask an admin to set it under Diesel &gt;
          Sites so fuel prices can be fetched automatically.
        </p>
      </Card>
    );
  }
  if (diesel == null && petrol == null) {
    return (
      <Card className="border-warn/30 bg-warn-soft">
        <p className="text-sm text-warn">
          No fuel price available for {city} yet — the report still saves, but
          costs stay blank until a price is fetched.
        </p>
      </Card>
    );
  }
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3">
      <CardLabel className="w-full sm:w-auto">
        Fuel price · {city}
        {source === "stale" && priceDate ? ` (as of ${priceDate})` : ""}
      </CardLabel>
      {diesel != null && (
        <p className="text-sm">
          Diesel <span className="font-semibold tabular-nums">₹{diesel.toFixed(2)}/L</span>
        </p>
      )}
      {petrol != null && (
        <p className="text-sm">
          Petrol <span className="font-semibold tabular-nums">₹{petrol.toFixed(2)}/L</span>
        </p>
      )}
    </Card>
  );
}

type SoItem = {
  m: {
    id: string;
    name: string;
    project_id: string;
    ownership: "internal" | "external";
  };
  s: { state: string; days?: number };
};

function SoAlert({
  expired,
  soon,
  siteNameById,
  pendingByMachine,
  showRequestActions = false,
}: {
  expired: SoItem[];
  soon: SoItem[];
  siteNameById?: Map<string, string>;
  pendingByMachine?: Map<string, "renewal" | "removal">;
  showRequestActions?: boolean;
}) {
  if (expired.length === 0 && soon.length === 0) return null;
  const label = (project_id: string) =>
    siteNameById ? ` · ${siteNameById.get(project_id) ?? "—"}` : "";

  const actions = (m: SoItem["m"]) =>
    showRequestActions ? (
      <div className="mt-1">
        <MachineRequestButtons
          machineId={m.id}
          ownership={m.ownership}
          pendingType={pendingByMachine?.get(m.id) ?? null}
        />
      </div>
    ) : null;

  return (
    <div className="space-y-2">
      {expired.length > 0 && (
        <Card className="border-danger/30 bg-danger-soft">
          <p className="text-sm font-semibold text-danger">
            {expired.length} machine{expired.length === 1 ? "" : "s"} past the SO
            date{showRequestActions ? " — renew or request removal" : ""}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {expired.map(({ m, s }) => (
              <li key={m.id} className="text-sm text-danger">
                <a href="/diesel/machines" className="font-medium hover:underline">
                  {m.name}
                  {label(m.project_id)}
                </a>{" "}
                — {s.days}d over
                {actions(m)}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {soon.length > 0 && (
        <Card className="border-warn/30 bg-warn-soft">
          <p className="text-sm font-semibold text-warn">
            {soon.length} machine{soon.length === 1 ? "" : "s"} nearing the SO
            deadline
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {soon.map(({ m, s }) => (
              <li key={m.id} className="text-sm text-warn">
                <a href="/diesel/machines" className="font-medium hover:underline">
                  {m.name}
                  {label(m.project_id)}
                </a>{" "}
                — {s.days}d left
                {actions(m)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type PendingReqRow = {
  id: string;
  machine_id: string;
  project_id: string;
  type: "renewal" | "removal";
  note: string | null;
  created_at: string;
  machines: { name: string; ownership: "internal" | "external"; registration_no: string | null } | null;
  requester: { full_name: string | null } | null;
};

function PendingRequestsPanel({
  rows,
  siteNameById,
}: {
  rows: PendingReqRow[];
  siteNameById: Map<string, string>;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 px-5 pt-4">
        <h2 className="text-sm font-semibold">Machine requests</h2>
        <Badge tone="warn">{rows.length} pending</Badge>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {rows.map((r) => {
          const machine = r.machines;
          const ownership = machine?.ownership ?? "internal";
          return (
            <li
              key={r.id}
              className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone={r.type === "removal" ? "danger" : "accent"}>
                    {r.type}
                  </Badge>
                  <span className="font-medium text-ink">
                    {machine?.name ?? "Machine"}
                  </span>
                  <span className="text-ink-3">
                    · {siteNameById.get(r.project_id) ?? "—"}
                  </span>
                </div>
                <p className="mt-0.5 text-ink-2">
                  {r.requester?.full_name ? `${r.requester.full_name} · ` : ""}
                  {new Date(r.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  })}
                  {r.note ? ` — “${r.note}”` : ""}
                </p>
              </div>
              <RequestResolveControls
                requestId={r.id}
                type={r.type}
                ownership={ownership}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default async function DieselPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; machine?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  // Supervisors can only ever file today's report — no date picker, no
  // backdating. A missed day's fuel gets folded into today's entry instead
  // (see the gap nudge below), which also sidesteps the fuel-price API
  // only ever having a live rate for "today."
  const date = today;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("role, home_project_id")
        .eq("id", user.id)
        .single()
    : { data: null };

  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  const homeProjectId = profile?.home_project_id ?? null;

  if (!isAdmin && !homeProjectId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Diesel Report" />
        <Card>
          <p className="text-sm text-ink-2">
            Your account isn&apos;t assigned to a site yet — ask an admin to set
            your site under Users before filling the daily report.
          </p>
        </Card>
      </div>
    );
  }

  const siteFilter = isAdmin ? (sp.site ?? null) : homeProjectId;

  // Machines that ask for fuel OR just a reading (e.g. a batching plant's
  // hours) belong on the daily report; pure fixtures with neither (tower
  // cranes, silos, office cars) live only on the Machinery page.
  const machinesQuery = supabase
    .from("machines")
    .select("*")
    .eq("is_active", true)
    .or("track_fuel.eq.true,track_meter.eq.true")
    .order("name");
  // Admin narrows to one chosen site via the dropdown. A supervisor gets
  // no explicit filter here — RLS naturally returns their own site's
  // machines plus any INTERNAL machine belonging to another site in their
  // group (a shared fleet); external machines never leave their own site,
  // so they're unaffected either way.
  if (isAdmin && siteFilter) machinesQuery.eq("project_id", siteFilter);

  const [{ data: machinesRaw }, projectsRes, siteRes] = await Promise.all([
    machinesQuery,
    isAdmin
      ? supabase.from("projects").select("id, name, code, state").eq("is_active", true).order("name")
      : Promise.resolve({ data: null }),
    siteFilter
      ? supabase.from("projects").select("id, name, state, shraddha_pump").eq("id", siteFilter).single()
      : Promise.resolve({ data: null }),
  ]);

  const machines = (machinesRaw ?? []) as Machine[];
  const projects = (projectsRes.data ?? []) as { id: string; name: string; code: string | null; state: string | null }[];
  const site = siteRes.data as { id: string; name: string; state: string | null; shraddha_pump?: boolean } | null;
  const siteCity = cityForState(site?.state ?? null);

  // SO / deployment-deadline status across ALL active machines at the
  // relevant site(s) — including non-fuel assets, which the machines query
  // above excludes. This drives the "past their SO duration" alert.
  const soQuery = supabase
    .from("machines")
    .select("id, name, so_until, project_id, ownership")
    .eq("is_active", true)
    .not("so_until", "is", null);
  if (siteFilter) soQuery.eq("project_id", siteFilter);

  const pendingReqQuery = supabase
    .from("machine_requests")
    .select("machine_id, type")
    .eq("status", "pending");
  if (siteFilter) pendingReqQuery.eq("project_id", siteFilter);

  const [{ data: soRaw }, { data: pendingReqRaw }] = await Promise.all([
    soQuery,
    pendingReqQuery,
  ]);

  const soMachines = (soRaw ?? []) as Pick<
    Machine,
    "id" | "name" | "so_until" | "project_id" | "ownership"
  >[];
  const pendingByMachine = new Map<string, "renewal" | "removal">(
    (pendingReqRaw ?? []).map((r) => [
      r.machine_id,
      r.type as "renewal" | "removal",
    ]),
  );
  const soExpired = soMachines
    .map((m) => ({ m, s: soStatus(m) }))
    .filter((x) => x.s.state === "expired")
    .sort((a, b) => (b.s.state === "expired" ? b.s.days : 0) - (a.s.state === "expired" ? a.s.days : 0));
  const soSoon = soMachines
    .map((m) => ({ m, s: soStatus(m) }))
    .filter((x) => x.s.state === "soon");

  // ---------- Supervisor: the daily sheet ----------
  if (!isAdmin) {
    const machineIds = machines.map((m) => m.id);

    const gapLookback = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

    const [{ data: existingRaw }, prices, { data: flagsRaw }, { data: receiptsRaw }, { data: recentLogsRaw }] =
      await Promise.all([
        machineIds.length
          ? supabase
              .from("daily_logs")
              .select("*")
              .eq("log_date", date)
              .in("machine_id", machineIds)
          : Promise.resolve({ data: [] }),
        getPricesForCity(siteCity, date),
        supabase
          .from("anomaly_flags")
          .select("id, severity, message, created_at, daily_logs!inner(machine_id, log_date, project_id)")
          .eq("resolved", false)
          .order("created_at", { ascending: false })
          .limit(10),
        homeProjectId
          ? supabase
              .from("fuel_receipts")
              .select("*")
              .eq("project_id", homeProjectId)
              .order("receipt_date", { ascending: false })
              .limit(10)
          : Promise.resolve({ data: [] }),
        // Each machine's most recent report before today, to flag a gap in
        // reporting — the site person adds the missed days' fuel into
        // today's entry rather than filing a separate backdated report.
        machineIds.length
          ? supabase
              .from("daily_logs")
              .select("machine_id, log_date")
              .in("machine_id", machineIds)
              .gte("log_date", gapLookback)
              .lt("log_date", today)
              .order("log_date", { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);
    const receipts = (receiptsRaw ?? []) as FuelReceipt[];

    const existing: Record<string, DailyLog> = {};
    for (const log of (existingRaw ?? []) as DailyLog[]) {
      existing[log.machine_id] = log;
    }

    const lastReportedByMachine: Record<string, string> = {};
    for (const l of (recentLogsRaw ?? []) as { machine_id: string; log_date: string }[]) {
      if (!(l.machine_id in lastReportedByMachine)) lastReportedByMachine[l.machine_id] = l.log_date;
    }

    const machineById = new Map(machines.map((m) => [m.id, m]));
    const flags = flagsRaw ?? [];

    // Label for any machine's home site that isn't this caller's own —
    // only relevant once a shared internal machine from another group
    // site shows up on this sheet.
    const otherSiteIds = [...new Set(machines.map((m) => m.project_id))].filter(
      (id) => id !== homeProjectId,
    );
    const { data: otherSitesRaw } = otherSiteIds.length
      ? await supabase.from("projects").select("id, name, code").in("id", otherSiteIds)
      : { data: [] };
    const siteLabelById: Record<string, string> = {};
    for (const p of (otherSitesRaw ?? []) as { id: string; name: string; code: string | null }[]) {
      siteLabelById[p.id] = p.code ? `${p.code} · ${p.name}` : p.name;
    }

    return (
      <div className="space-y-6">
        <PageHeader
          title="Daily Diesel Report"
          subtitle={`${site?.name ?? "Your site"} — ${new Date(today).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
        />

        <PriceBanner
          city={siteCity}
          diesel={prices.diesel}
          petrol={prices.petrol}
          source={prices.source}
          priceDate={prices.priceDate}
        />

        <SoAlert
          expired={soExpired}
          soon={soSoon}
          pendingByMachine={pendingByMachine}
          showRequestActions
        />

        <DailySheet
          machines={machines}
          existing={existing}
          logDate={date}
          dieselPrice={prices.diesel}
          petrolPrice={prices.petrol}
          shraddhaPump={site?.shraddha_pump ?? false}
          lastReportedByMachine={lastReportedByMachine}
          homeProjectId={homeProjectId}
          siteLabelById={siteLabelById}
        />

        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">Diesel received</h2>
              <p className="text-xs text-ink-3">
                Record a barrel / delivery arriving on site — separate from the fuel logged to machines above
              </p>
            </div>
            {homeProjectId && <FuelReceiptForm projectId={homeProjectId} today={today} />}
          </div>
          {receipts.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="text-ink-2">
                    <span className="font-mono tabular-nums text-ink">{Number(r.liters).toFixed(0)} L</span>
                    {r.barrels ? ` · ${r.barrels} barrel${r.barrels === 1 ? "" : "s"}` : ""} ·{" "}
                    {r.receipt_date}
                    {r.total_cost != null ? ` · ${inr(Number(r.total_cost))}` : ""}
                    {r.vendor ? ` · ${r.vendor}` : ""}
                  </span>
                  <form action={deleteFuelReceipt}>
                    <input type="hidden" name="receipt_id" value={r.id} />
                    <button type="submit" className="text-xs text-ink-3 hover:text-danger">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {flags.length > 0 && (
          <Card className="p-0">
            <h2 className="px-5 pt-4 text-sm font-semibold">
              Open flags for your site
            </h2>
            <ul className="mt-3 divide-y divide-line">
              {flags.map((f) => {
                const log = f.daily_logs as unknown as {
                  machine_id: string;
                  log_date: string;
                };
                const m = machineById.get(log.machine_id);
                return (
                  <li
                    key={f.id}
                    className="flex items-center gap-2.5 px-5 py-2.5 text-sm"
                  >
                    <Badge tone={SEVERITY_TONE[f.severity] ?? "warn"}>
                      {f.severity}
                    </Badge>
                    <span className="text-ink-2">
                      <span className="font-medium text-ink">
                        {m?.name ?? "Machine"}
                      </span>{" "}
                      · {log.log_date} — {f.message}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    );
  }

  // ---------- Admin: cross-site dashboard ----------
  // The report table below is scoped to one day at a time (default today) —
  // charts/30-day totals still draw on the broader fetch below, but the
  // "Daily Report" listing itself should show that day's reports, not a
  // scrolling dump of the last 1000 rows across every date.
  const reportDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  const logsQuery = supabase
    .from("daily_logs")
    .select("*")
    .order("log_date", { ascending: false })
    .limit(1000);
  if (siteFilter) logsQuery.eq("project_id", siteFilter);
  if (sp.machine) logsQuery.eq("machine_id", sp.machine);

  // A dedicated, exact query for the report table — the broad fetch above
  // (most-recent 1000 rows) can miss an older reportDate entirely once
  // there's more history than that across every site.
  const dayLogsQuery = supabase
    .from("daily_logs")
    .select("*")
    .eq("log_date", reportDate);
  if (siteFilter) dayLogsQuery.eq("project_id", siteFilter);
  if (sp.machine) dayLogsQuery.eq("machine_id", sp.machine);

  const flagsQuery = supabase
    .from("anomaly_flags")
    .select("id, severity, message, created_at, daily_logs!inner(machine_id, log_date, project_id)")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (siteFilter) flagsQuery.eq("daily_logs.project_id", siteFilter);

  const pendingRequestsQuery = supabase
    .from("machine_requests")
    .select(
      "id, machine_id, project_id, type, note, created_at, machines(name, ownership, registration_no), requester:requested_by(full_name)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (siteFilter) pendingRequestsQuery.eq("project_id", siteFilter);

  const [{ data: logsRaw }, { data: dayLogsRaw }, { data: flagsRaw }, prices, { data: pendingReqRows }] =
    await Promise.all([
      logsQuery,
      dayLogsQuery,
      flagsQuery,
      getPricesForCity(siteCity, today),
      pendingRequestsQuery,
    ]);

  const logs = (logsRaw ?? []) as DailyLog[];
  const dayLogs = (dayLogsRaw ?? []) as DailyLog[];
  const flags = flagsRaw ?? [];
  const machineById = new Map(machines.map((m) => [m.id, m]));

  // A log can reference a machine that's since been deactivated (removed
  // by a site person) — the log itself is still real history and must
  // keep showing its machine's name/type, not just a blank dash.
  const missingMachineIds = [
    ...new Set(
      [...logs, ...dayLogs].map((l) => l.machine_id).filter((id) => !machineById.has(id)),
    ),
  ];
  if (missingMachineIds.length) {
    const { data: inactiveMachines } = await supabase
      .from("machines")
      .select("*")
      .in("id", missingMachineIds);
    for (const m of (inactiveMachines ?? []) as Machine[]) machineById.set(m.id, m);
  }

  const chartMachines = sp.machine
    ? machines.filter((m) => m.id === sp.machine)
    : machines;
  const points = efficiencyPoints(chartMachines, logs);
  const kmPoints = points.filter((p) => p.unit === "km/L");
  const hourPoints = points.filter((p) => p.unit === "L/hr");

  // Per-row mileage (this day's own km/L or L/hr) and each machine's
  // current running average, both keyed off the same fetched logs —
  // machine_id + date is unique because of the one-report-per-day rule.
  // Uses every machine referenced by these logs (including deactivated
  // ones) so a removed machine's history still shows its mileage.
  const allMachines = [...machineById.values()];
  const allPoints = efficiencyPoints(allMachines, logs);
  const rowMetric = new Map(
    allPoints.map((p) => [`${p.machine_id}|${p.entry_date}`, p]),
  );
  const runningAvgByMachine = new Map<string, { value: number; unit: string }>();
  for (const m of allMachines) {
    const vals = allPoints.filter((p) => p.machine_id === m.id);
    if (vals.length === 0) continue;
    const avg = vals.reduce((s, p) => s + p.value, 0) / vals.length;
    runningAvgByMachine.set(m.id, { value: avg, unit: vals[0].unit });
  }

  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const recent = logs.filter((l) => l.log_date >= cutoff);
  const litres30 = recent.reduce((s, l) => s + Number(l.fuel_issued_liters), 0);
  const cost30 = recent.reduce((s, l) => s + Number(l.total_cost ?? 0), 0);
  const reportedToday = new Set(
    logs.filter((l) => l.log_date === today).map((l) => l.project_id),
  ).size;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diesel Report — All Sites"
        subtitle={`Daily consumption, efficiency and anomalies across every site — showing ${reportDate}`}
      />

      <form className="flex flex-wrap items-end gap-2">
        <Select name="site" defaultValue={sp.site ?? ""} className="min-w-44">
          <option value="">All sites</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select name="machine" defaultValue={sp.machine ?? ""} className="min-w-44">
          <option value="">All machines</option>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.registration_no ? ` · ${m.registration_no}` : ""}
            </option>
          ))}
        </Select>
        <Field label="Report date">
          <Input type="date" name="date" defaultValue={reportDate} max={today} className="min-w-40" />
        </Field>
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
      </form>

      {site && (
        <PriceBanner
          city={siteCity}
          diesel={prices.diesel}
          petrol={prices.petrol}
          source={prices.source}
          priceDate={prices.priceDate}
        />
      )}

      <PendingRequestsPanel
        rows={(pendingReqRows ?? []) as unknown as PendingReqRow[]}
        siteNameById={new Map(projects.map((p) => [p.id, p.name]))}
      />

      {/* Overstaying = past SO with no request filed. Machines that DO have
          a pending request are handled in the panel above, so drop them
          here to avoid nagging about something already in the queue. */}
      <SoAlert
        expired={soExpired.filter((x) => !pendingByMachine.has(x.m.id))}
        soon={soSoon.filter((x) => !pendingByMachine.has(x.m.id))}
        siteNameById={new Map(projects.map((p) => [p.id, p.name]))}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardLabel>Fuel issued · 30 days</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {litres30.toLocaleString("en-IN", { maximumFractionDigits: 0 })} L
          </p>
        </Card>
        <Card>
          <CardLabel>Cost · 30 days</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {inr(cost30)}
          </p>
        </Card>
        <Card>
          <CardLabel>Sites reported today</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {reportedToday}
          </p>
        </Card>
        <Card>
          <CardLabel>Open flags</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {flags.length}
          </p>
        </Card>
      </div>

      {flags.length > 0 && (
        <Card className="p-0">
          <div className="flex items-center justify-between px-5 pt-4">
            <h2 className="text-sm font-semibold">Open anomaly flags</h2>
            <a
              href="/diesel/anomalies"
              className="text-xs font-medium text-accent hover:underline"
            >
              Review all →
            </a>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {flags.slice(0, 6).map((f) => {
              const log = f.daily_logs as unknown as {
                machine_id: string;
                log_date: string;
              };
              const m = machineById.get(log.machine_id);
              return (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Badge tone={SEVERITY_TONE[f.severity] ?? "warn"}>
                      {f.severity}
                    </Badge>
                    <span className="truncate text-ink-2">
                      <span className="font-medium text-ink">
                        {m?.name ?? "Machine"}
                      </span>{" "}
                      · {log.log_date} — {f.message}
                    </span>
                  </div>
                  <form action={resolveFlag}>
                    <input type="hidden" name="flag_id" value={f.id} />
                    <Button variant="secondary" size="sm" type="submit">
                      Resolve
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {(kmPoints.length > 0 || hourPoints.length > 0) && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {kmPoints.length > 0 && (
            <Card>
              <CardLabel>Vehicle efficiency — km per liter</CardLabel>
              <div className="mt-3">
                <EfficiencyChart points={kmPoints} />
              </div>
            </Card>
          )}
          {hourPoints.length > 0 && (
            <Card>
              <CardLabel>Hourly consumption — liters per hour</CardLabel>
              <div className="mt-3">
                <EfficiencyChart points={hourPoints} />
              </div>
            </Card>
          )}
        </div>
      )}

      <DailyLogsBySite
        logs={dayLogs}
        machineById={machineById}
        projects={projects}
        rowMetric={rowMetric}
        runningAvgByMachine={runningAvgByMachine}
        reportDate={reportDate}
      />
    </div>
  );
}

function DailyLogsBySite({
  logs,
  machineById,
  projects,
  rowMetric,
  runningAvgByMachine,
  reportDate,
}: {
  logs: DailyLog[];
  machineById: Map<string, Machine>;
  projects: { id: string; name: string; code: string | null }[];
  rowMetric: Map<string, EfficiencyPoint>;
  runningAvgByMachine: Map<string, { value: number; unit: string }>;
  reportDate: string;
}) {
  const siteLabel = new Map(
    projects.map((p) => [p.id, p.code ? `${p.code} · ${p.name}` : p.name]),
  );

  const groups = new Map<string, DailyLog[]>();
  for (const l of logs) {
    const key = siteLabel.get(l.project_id) ?? "— Unassigned";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(l);
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (logs.length === 0) {
    return (
      <Card className="p-0">
        <EmptyState message={`No daily reports for ${reportDate}.`} />
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto p-0">
      <Table>
        <thead>
          <tr>
            <TH>Date</TH>
            <TH>Machine</TH>
            <TH className="text-right">Opening</TH>
            <TH className="text-right">Closing</TH>
            <TH className="text-right">Fuel (L)</TH>
            <TH className="text-right">Mileage</TH>
            <TH className="text-right">Running avg</TH>
            <TH className="text-right">Rate</TH>
            <TH className="text-right">Cost</TH>
            <TH>Remarks</TH>
          </tr>
        </thead>
        <tbody>
          {orderedGroups.map(([label, siteLogs]) => (
            <Fragment key={label}>
              <tr className="bg-surface-2">
                <td colSpan={10} className="border-y border-line px-4 py-2 text-sm font-semibold text-ink">
                  {label}
                  <span className="ml-2 text-xs font-normal text-ink-3">
                    {siteLogs.length} report{siteLogs.length === 1 ? "" : "s"}
                  </span>
                </td>
              </tr>
              {siteLogs.map((l) => {
                const m = machineById.get(l.machine_id);
                const metric = rowMetric.get(`${l.machine_id}|${l.log_date}`);
                const avg = runningAvgByMachine.get(l.machine_id);
                return (
                  <TRow key={l.id}>
                    <TD className="whitespace-nowrap">{l.log_date}</TD>
                    <TD>
                      <span className="font-medium">{m?.name ?? "—"}</span>
                      {m?.registration_no && (
                        <span className="text-ink-3"> · {m.registration_no}</span>
                      )}
                    </TD>
                    <TD className="text-right font-mono tabular-nums">
                      {l.opening_reading ?? "—"}
                    </TD>
                    <TD className="text-right font-mono tabular-nums">
                      {l.closing_reading ?? "—"}
                    </TD>
                    <TD className="text-right font-mono tabular-nums">
                      {Number(l.fuel_issued_liters).toFixed(1)}
                      {l.fuel_source && l.fuel_source !== "on_site" && (
                        <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 font-sans text-[10px] uppercase tracking-wide text-ink-3">
                          {l.fuel_source === "shraddha" ? "Shraddha" : "offsite"}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right font-mono tabular-nums text-ink-2">
                      {metric ? (
                        <>
                          {metric.value.toFixed(2)} {metric.unit}
                          {metric.provisional && (
                            <span className="ml-1 text-[10px] text-ink-3" title="No later fill yet to close this one out — estimate using the current reading">
                              so far
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-right font-mono tabular-nums text-ink-2">
                      {avg ? `${avg.value.toFixed(2)} ${avg.unit}` : "—"}
                    </TD>
                    <TD className="text-right font-mono tabular-nums">
                      {l.rate_per_liter != null
                        ? `₹${Number(l.rate_per_liter).toFixed(2)}`
                        : "—"}
                    </TD>
                    <TD className="text-right font-mono tabular-nums">
                      {l.total_cost != null ? inr(Number(l.total_cost)) : "—"}
                    </TD>
                    <TD className="max-w-56 truncate text-ink-2">
                      {l.remarks ?? "—"}
                    </TD>
                  </TRow>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
