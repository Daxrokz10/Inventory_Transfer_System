import { createClient } from "@/lib/supabase/server";
import { Card, CardLabel } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import type { DailyLog, Machine } from "@/lib/diesel/types";
import { getPricesForCity } from "@/lib/diesel/fuelPrice";
import { cityForState, soStatus } from "@/lib/diesel/types";
import { DailySheet } from "./DailySheet";
import { MachineRequestButtons } from "./machines/MachineRequestButtons";
import { RequestResolveControls } from "./machines/RequestResolveControls";
import { EfficiencyChart, type EfficiencyPoint } from "./EfficiencyChart";
import { resolveFlag } from "./actions";

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

function efficiencyPoints(
  machines: Machine[],
  logs: DailyLog[],
): EfficiencyPoint[] {
  const byId = new Map(machines.map((m) => [m.id, m]));
  const points: EfficiencyPoint[] = [];
  for (const log of logs) {
    const m = byId.get(log.machine_id);
    if (!m || log.opening_reading == null || log.closing_reading == null) continue;
    const delta = Number(log.closing_reading) - Number(log.opening_reading);
    const fuel = Number(log.fuel_issued_liters);
    if (delta <= 0 || fuel <= 0) continue;
    points.push({
      machine_id: m.id,
      machine_label: m.name,
      entry_date: log.log_date,
      value: m.reading_type === "hours" ? fuel / delta : delta / fuel,
      unit: m.reading_type === "hours" ? "L/hr" : "km/L",
    });
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
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;

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

  // Only fuel-tracked machines belong on the fuel report / dashboard;
  // non-fuel assets (silos, office cars, …) live on the Machinery page.
  const machinesQuery = supabase
    .from("machines")
    .select("*")
    .eq("is_active", true)
    .eq("track_fuel", true)
    .order("name");
  if (siteFilter) machinesQuery.eq("project_id", siteFilter);

  const [{ data: machinesRaw }, projectsRes, siteRes] = await Promise.all([
    machinesQuery,
    isAdmin
      ? supabase.from("projects").select("id, name, state").eq("is_active", true).order("name")
      : Promise.resolve({ data: null }),
    siteFilter
      ? supabase.from("projects").select("id, name, state").eq("id", siteFilter).single()
      : Promise.resolve({ data: null }),
  ]);

  const machines = (machinesRaw ?? []) as Machine[];
  const projects = projectsRes.data ?? [];
  const site = siteRes.data as { id: string; name: string; state: string | null } | null;
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

    const [{ data: existingRaw }, prices, { data: flagsRaw }] = await Promise.all([
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
    ]);

    const existing: Record<string, DailyLog> = {};
    for (const log of (existingRaw ?? []) as DailyLog[]) {
      existing[log.machine_id] = log;
    }

    const machineById = new Map(machines.map((m) => [m.id, m]));
    const flags = flagsRaw ?? [];

    return (
      <div className="space-y-6">
        <PageHeader
          title="Daily Diesel Report"
          subtitle={`${site?.name ?? "Your site"} — every machine, every day`}
          actions={
            <form className="flex items-center gap-2">
              <Input type="date" name="date" defaultValue={date} max={today} />
              <Button type="submit" variant="secondary" size="sm">
                Open
              </Button>
            </form>
          }
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
        />

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
  const logsQuery = supabase
    .from("daily_logs")
    .select("*")
    .order("log_date", { ascending: false })
    .limit(1000);
  if (siteFilter) logsQuery.eq("project_id", siteFilter);
  if (sp.machine) logsQuery.eq("machine_id", sp.machine);

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

  const [{ data: logsRaw }, { data: flagsRaw }, prices, { data: pendingReqRows }] =
    await Promise.all([
      logsQuery,
      flagsQuery,
      getPricesForCity(siteCity, today),
      pendingRequestsQuery,
    ]);

  const logs = (logsRaw ?? []) as DailyLog[];
  const flags = flagsRaw ?? [];
  const machineById = new Map(machines.map((m) => [m.id, m]));

  const chartMachines = sp.machine
    ? machines.filter((m) => m.id === sp.machine)
    : machines;
  const points = efficiencyPoints(chartMachines, logs);
  const kmPoints = points.filter((p) => p.unit === "km/L");
  const hourPoints = points.filter((p) => p.unit === "L/hr");

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
        subtitle="Daily consumption, efficiency and anomalies across every site"
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
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            {litres30.toLocaleString("en-IN", { maximumFractionDigits: 0 })} L
          </p>
        </Card>
        <Card>
          <CardLabel>Cost · 30 days</CardLabel>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            {inr(cost30)}
          </p>
        </Card>
        <Card>
          <CardLabel>Sites reported today</CardLabel>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            {reportedToday}
          </p>
        </Card>
        <Card>
          <CardLabel>Open flags</CardLabel>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
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

      <Card className="overflow-x-auto p-0">
        <Table>
          <thead>
            <tr>
              <TH>Date</TH>
              <TH>Machine</TH>
              <TH className="text-right">Opening</TH>
              <TH className="text-right">Closing</TH>
              <TH className="text-right">Fuel (L)</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Cost</TH>
              <TH>Remarks</TH>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <TD colSpan={8}>
                  <EmptyState message="No daily reports yet." />
                </TD>
              </tr>
            ) : (
              logs.slice(0, 50).map((l) => {
                const m = machineById.get(l.machine_id);
                return (
                  <TRow key={l.id}>
                    <TD className="whitespace-nowrap">{l.log_date}</TD>
                    <TD>
                      <span className="font-medium">{m?.name ?? "—"}</span>
                      {m?.registration_no && (
                        <span className="text-ink-3"> · {m.registration_no}</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {l.opening_reading ?? "—"}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {l.closing_reading ?? "—"}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {Number(l.fuel_issued_liters).toFixed(1)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {l.rate_per_liter != null
                        ? `₹${Number(l.rate_per_liter).toFixed(2)}`
                        : "—"}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {l.total_cost != null ? inr(Number(l.total_cost)) : "—"}
                    </TD>
                    <TD className="max-w-56 truncate text-ink-2">
                      {l.remarks ?? "—"}
                    </TD>
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
