import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import { NotMetered, StatusPill } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { soStatus, type Machine } from "@/lib/diesel/types";
import { computeFillMetrics } from "@/lib/diesel/efficiency";
import { NewMachineButton } from "./MachineForm";
import { MachineActions, MeterBrokenControl } from "./MachineActions";
import { MachineRequestButtons } from "./MachineRequestButtons";
import { RemoveHiredMachineButton } from "./RemoveHiredMachineButton";
import { MachinesToolbar } from "./MachinesToolbar";

type GroupBy = "site" | "type";

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const groupBy: GroupBy = sp.group === "type" ? "type" : "site";
  const q = (sp.q ?? "").trim().toLowerCase();

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

  // Extra sites a non-admin may register a NEW external machine at,
  // beyond their own — only populated when their site's group has opted
  // into sharing external machines (most groups haven't, e.g. Dahej).
  let addableSites: { id: string; name: string; code: string | null }[] = [];
  if (!isAdmin && homeProjectId) {
    const { data: myProject } = await supabase
      .from("projects")
      .select("group_id")
      .eq("id", homeProjectId)
      .single();
    if (myProject?.group_id) {
      const { data: group } = await supabase
        .from("site_groups")
        .select("share_external")
        .eq("id", myProject.group_id)
        .single();
      if (group?.share_external) {
        const { data: groupSites } = await supabase
          .from("projects")
          .select("id, name, code")
          .eq("group_id", myProject.group_id)
          .order("code");
        addableSites = groupSites ?? [];
      }
    }
  }

  const avgCutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

  // Removed (deactivated) machines drop off this list entirely — their
  // diesel history still lives on in the Register/Reports, which query
  // daily_logs directly and don't filter on is_active. No explicit site
  // filter here — RLS already scopes this to a supervisor's own site plus
  // whatever their group additionally grants (a shared internal fleet
  // always; shared external machines too when the group has opted in).
  const machinesQuery = supabase.from("machines").select("*").eq("is_active", true).order("name");

  const [{ data: machinesRaw }, { data: projects }, { data: reqRaw }, { data: recentLogsRaw }] =
    await Promise.all([
      machinesQuery,
      supabase
        .from("projects")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("machine_requests")
        .select("machine_id, type")
        .eq("status", "pending"),
      supabase
        .from("daily_logs")
        .select("id, machine_id, log_date, opening_reading, closing_reading, fuel_issued_liters")
        .gt("fuel_issued_liters", 0)
        .gte("log_date", avgCutoff),
    ]);

  const machines = (machinesRaw ?? []) as Machine[];
  const siteList = projects ?? [];
  const siteName = new Map(siteList.map((p) => [p.id, p.name]));
  const siteCode = new Map(siteList.map((p) => [p.id, p.code]));

  // Current running average (last 90 days) per machine — km/L or L/hr,
  // matching how the machine is metered. Each fill is attributed to the
  // full distance/hours it covered through the NEXT fill (see
  // efficiency.ts), not just its own day's movement.
  type RecentLog = {
    id: string;
    machine_id: string;
    log_date: string;
    opening_reading: number | null;
    closing_reading: number | null;
    fuel_issued_liters: number;
  };
  const logsByMachine = new Map<string, RecentLog[]>();
  for (const l of (recentLogsRaw ?? []) as RecentLog[]) {
    (logsByMachine.get(l.machine_id) ?? logsByMachine.set(l.machine_id, []).get(l.machine_id)!).push(l);
  }
  const runningAvg = new Map<string, number>();
  for (const m of machines) {
    const rows = logsByMachine.get(m.id);
    if (!rows || rows.length === 0) continue;
    const vals = computeFillMetrics(m, rows, m.current_reading)
      .filter((fm) => fm.plausible)
      .map((fm) => fm.value);
    if (vals.length > 0) runningAvg.set(m.id, vals.reduce((s, v) => s + v, 0) / vals.length);
  }
  // machine_id → the type of its open request (if any).
  const pendingByMachine = new Map<string, "renewal" | "removal">(
    (reqRaw ?? []).map((r) => [r.machine_id, r.type as "renewal" | "removal"]),
  );

  // Search across name, type, numberplate, vendor, and site (name OR code
  // — "J-0085" should find NDDB BANAS PROEJCT just as well as its name).
  const filteredMachines = q
    ? machines.filter((m) => {
        const site = siteName.get(m.project_id) ?? "";
        const code = siteCode.get(m.project_id) ?? "";
        return [m.name, m.machine_type, m.registration_no, m.vendor_name, site, code]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q));
      })
    : machines;

  // Group machines by the chosen key, then sort the groups by label. Site
  // groups are labelled "CODE · Name" so the header carries the code too.
  const groups = new Map<string, Machine[]>();
  for (const m of filteredMachines) {
    const key =
      groupBy === "site"
        ? siteCode.get(m.project_id)
          ? `${siteCode.get(m.project_id)} · ${siteName.get(m.project_id)}`
          : siteName.get(m.project_id) ?? "— Unassigned"
        : m.machine_type;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // When grouped by site, the Site column is redundant; likewise Type.
  const showSiteCol = isAdmin && groupBy !== "site";
  const showTypeCol = groupBy !== "type";
  // 8 always-present columns: Machine, Numberplate, Fuel, Metered by,
  // Current reading, Running avg, Ownership, Actions — plus optional Site / Type.
  const colCount = 8 + (showSiteCol ? 1 : 0) + (showTypeCol ? 1 : 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Machinery"
        subtitle={
          isAdmin
            ? "All machines and DG sets across sites"
            : "Machines and DG sets working at your site"
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {(isAdmin || homeProjectId) && (
          <NewMachineButton
            sites={siteList}
            homeProjectId={homeProjectId}
            addableSites={addableSites}
            isAdmin={isAdmin}
          />
        )}
        <MachinesToolbar
          groupBy={groupBy}
          initialQuery={sp.q ?? ""}
          showGroupToggle={isAdmin}
        />
      </div>

      <Card className="overflow-x-auto p-0">
        <Table>
          <thead>
            <tr>
              {showSiteCol && <TH>Site</TH>}
              <TH>Machine</TH>
              {showTypeCol && <TH>Type</TH>}
              <TH>Numberplate</TH>
              <TH>Fuel</TH>
              <TH>Metered by</TH>
              <TH className="text-right">Current reading</TH>
              <TH className="text-right">Running avg</TH>
              <TH>Ownership</TH>
              <TH>Actions</TH>
            </tr>
          </thead>
          <tbody>
            {filteredMachines.length === 0 ? (
              <tr>
                <TD colSpan={colCount}>
                  <EmptyState
                    message={
                      machines.length === 0
                        ? "No machinery registered yet — add the machines working at your site."
                        : `No machines match "${sp.q}".`
                    }
                  />
                </TD>
              </tr>
            ) : (
              orderedGroups.map(([label, groupMachines]) => (
                <GroupBlock
                  key={label}
                  label={label}
                  machines={groupMachines}
                  siteName={siteName}
                  siteCode={siteCode}
                  siteList={siteList}
                  isAdmin={isAdmin}
                  homeProjectId={homeProjectId}
                  pendingByMachine={pendingByMachine}
                  showSiteCol={showSiteCol}
                  showTypeCol={showTypeCol}
                  colCount={colCount}
                  runningAvg={runningAvg}
                />
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function GroupBlock({
  label,
  machines,
  siteName,
  siteCode,
  siteList,
  isAdmin,
  homeProjectId,
  pendingByMachine,
  showSiteCol,
  showTypeCol,
  colCount,
  runningAvg,
}: {
  label: string;
  machines: Machine[];
  siteName: Map<string, string>;
  siteCode: Map<string, string | null>;
  siteList: { id: string; name: string; code: string | null }[];
  isAdmin: boolean;
  homeProjectId: string | null;
  pendingByMachine: Map<string, "renewal" | "removal">;
  showSiteCol: boolean;
  showTypeCol: boolean;
  colCount: number;
  runningAvg: Map<string, number>;
}) {
  return (
    <>
      <tr className="bg-surface-2">
        <td
          colSpan={colCount}
          className="border-y border-line px-4 py-2 text-sm font-semibold text-ink"
        >
          {label}
          <span className="ml-2 text-xs font-normal text-ink-3">
            {machines.length} machine{machines.length === 1 ? "" : "s"}
          </span>
        </td>
      </tr>
      {machines.map((m) => {
        const unit = m.reading_type === "hours" ? "hr" : "km";
        const so = soStatus(m);
        return (
          <TRow
            key={m.id}
            className={cn(
              so.state === "expired" && "shadow-[inset_3px_0_0_var(--color-alarm-led)]",
              so.state === "soon" && "shadow-[inset_3px_0_0_var(--color-caution-led)]",
            )}
          >
            {showSiteCol && (
              <TD className="text-ink-2">
                {siteCode.get(m.project_id) && (
                  <span className="font-mono text-xs text-ink-3">
                    {siteCode.get(m.project_id)} ·{" "}
                  </span>
                )}
                {siteName.get(m.project_id) ?? "—"}
              </TD>
            )}
            <TD className="font-medium">
              <a href={`/diesel/machines/${m.id}`} className="hover:underline">
                {m.name}
              </a>
              {!m.track_fuel && (
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                  asset
                </span>
              )}
              {isAdmin && m.flagged_suspicious && (
                <Badge tone="danger" className="ml-2">
                  Suspicious
                </Badge>
              )}
              {so.state === "expired" && (
                <StatusPill tone="alarm" className="ml-2">
                  SO expired · {so.days}d over
                </StatusPill>
              )}
              {so.state === "soon" && (
                <StatusPill tone="caution" className="ml-2">
                  SO ends in {so.days}d
                </StatusPill>
              )}
            </TD>
            {showTypeCol && <TD className="text-ink-2">{m.machine_type}</TD>}
            <TD className="font-mono text-xs text-ink-2">
              {m.registration_no ?? <NotMetered label="no plate" />}
            </TD>
            <TD className="capitalize text-ink-2">
              {m.track_fuel ? m.fuel_type : <NotMetered label="no fuel" />}
            </TD>
            <TD className="text-ink-2">
              {!m.track_fuel ? (
                <NotMetered label="—" />
              ) : m.meter_broken ? (
                <StatusPill tone="alarm">Meter broken</StatusPill>
              ) : m.reading_type === "hours" ? (
                "Running hours"
              ) : (
                "Odometer (km)"
              )}
            </TD>
            <TD className="text-right">
              {m.current_reading != null ? (
                <span className="font-mono tabular-nums">
                  {m.current_reading} <span className="text-ink-3">{unit}</span>
                </span>
              ) : (
                <NotMetered label="—" />
              )}
            </TD>
            <TD className="text-right font-mono tabular-nums text-ink-2">
              {m.track_fuel && runningAvg.has(m.id)
                ? `${runningAvg.get(m.id)!.toFixed(2)} ${m.reading_type === "hours" ? "L/hr" : "km/L"}`
                : <NotMetered label="—" />}
            </TD>
            <TD>
              {m.ownership === "external" ? (
                <div className="space-y-0.5">
                  <Badge tone="warn">
                    External{m.vendor_name ? ` · ${m.vendor_name}` : ""}
                  </Badge>
                  {isAdmin && (
                    <p className="font-mono text-[11px] text-ink-3">
                      {m.monthly_rent != null ? (
                        <>₹{m.monthly_rent.toLocaleString("en-IN")}/mo</>
                      ) : (
                        <span className="text-warn">rent not entered</span>
                      )}
                    </p>
                  )}
                </div>
              ) : (
                <Badge tone="accent">Internal</Badge>
              )}
            </TD>
            <TD>
              <div className="flex items-center gap-3">
                {isAdmin ? (
                  <MachineActions machine={m} isAdmin={isAdmin} sites={siteList} />
                ) : (
                  (() => {
                    // SO renewal/removal requests stay tied to the
                    // machine's own site — a group grants shared
                    // visibility/fill-and-register reach, not the
                    // ability to file an SO request for a machine that
                    // isn't actually yours (machine_requests RLS is
                    // still strictly own-site-or-admin).
                    const ownSite = m.project_id === homeProjectId;
                    const req =
                      ownSite &&
                      (pendingByMachine.get(m.id) ||
                        so.state === "soon" ||
                        so.state === "expired");
                    const canRemove = m.ownership === "external" && m.is_active;
                    if (!req && !canRemove) {
                      return <span className="text-xs text-ink-3">—</span>;
                    }
                    return (
                      <div className="flex items-center gap-3">
                        {req && (
                          <MachineRequestButtons
                            machineId={m.id}
                            ownership={m.ownership}
                            pendingType={pendingByMachine.get(m.id) ?? null}
                          />
                        )}
                        {canRemove && (
                          <RemoveHiredMachineButton machineId={m.id} machineName={m.name} />
                        )}
                      </div>
                    );
                  })()
                )}
                <MeterBrokenControl machine={m} isAdmin={isAdmin} />
              </div>
            </TD>
          </TRow>
        );
      })}
    </>
  );
}
