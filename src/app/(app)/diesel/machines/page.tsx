import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import { soStatus, type Machine } from "@/lib/diesel/types";
import { NewMachineButton } from "./MachineForm";
import { MachineActions } from "./MachineActions";
import { MachineRequestButtons } from "./MachineRequestButtons";
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

  const [{ data: machinesRaw }, { data: projects }, { data: reqRaw }] =
    await Promise.all([
      supabase.from("machines").select("*").order("name"),
      supabase
        .from("projects")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("machine_requests")
        .select("machine_id, type")
        .eq("status", "pending"),
    ]);

  const machines = (machinesRaw ?? []) as Machine[];
  const siteList = projects ?? [];
  const siteName = new Map(siteList.map((p) => [p.id, p.name]));
  const siteCode = new Map(siteList.map((p) => [p.id, p.code]));
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
  // 7 always-present columns: Machine, Numberplate, Fuel, Metered by,
  // Current reading, Ownership, Actions — plus optional Site / Type.
  const colCount = 7 + (showSiteCol ? 1 : 0) + (showTypeCol ? 1 : 0);

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
                  pendingByMachine={pendingByMachine}
                  showSiteCol={showSiteCol}
                  showTypeCol={showTypeCol}
                  colCount={colCount}
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
  pendingByMachine,
  showSiteCol,
  showTypeCol,
  colCount,
}: {
  label: string;
  machines: Machine[];
  siteName: Map<string, string>;
  siteCode: Map<string, string | null>;
  siteList: { id: string; name: string; code: string | null }[];
  isAdmin: boolean;
  pendingByMachine: Map<string, "renewal" | "removal">;
  showSiteCol: boolean;
  showTypeCol: boolean;
  colCount: number;
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
          <TRow key={m.id} className={!m.is_active ? "opacity-55" : undefined}>
            {showSiteCol && (
              <TD className="text-ink-2">
                {siteCode.get(m.project_id) && (
                  <span className="text-ink-3">{siteCode.get(m.project_id)} · </span>
                )}
                {siteName.get(m.project_id) ?? "—"}
              </TD>
            )}
            <TD className="font-medium">
              {m.name}
              {!m.is_active && (
                <Badge tone="neutral" className="ml-2">
                  Inactive
                </Badge>
              )}
              {!m.track_fuel && (
                <Badge tone="neutral" className="ml-2">
                  No fuel tracking
                </Badge>
              )}
              {so.state === "expired" && (
                <Badge tone="danger" className="ml-2">
                  SO expired · {so.days}d over
                </Badge>
              )}
              {so.state === "soon" && (
                <Badge tone="warn" className="ml-2">
                  SO ends in {so.days}d
                </Badge>
              )}
            </TD>
            {showTypeCol && <TD className="text-ink-2">{m.machine_type}</TD>}
            <TD className="text-ink-2">{m.registration_no ?? "—"}</TD>
            <TD className="capitalize text-ink-2">
              {m.track_fuel ? m.fuel_type : "—"}
            </TD>
            <TD className="text-ink-2">
              {m.reading_type === "hours" ? "Running hours" : "Odometer (km)"}
            </TD>
            <TD className="text-right tabular-nums">
              {m.current_reading != null ? `${m.current_reading} ${unit}` : "—"}
            </TD>
            <TD>
              {m.ownership === "external" ? (
                <Badge tone="warn">
                  External{m.vendor_name ? ` · ${m.vendor_name}` : ""}
                </Badge>
              ) : (
                <Badge tone="accent">Internal</Badge>
              )}
            </TD>
            <TD>
              {isAdmin ? (
                <MachineActions machine={m} isAdmin={isAdmin} sites={siteList} />
              ) : pendingByMachine.get(m.id) ? (
                <MachineRequestButtons
                  machineId={m.id}
                  ownership={m.ownership}
                  pendingType={pendingByMachine.get(m.id)}
                />
              ) : so.state === "soon" || so.state === "expired" ? (
                <MachineRequestButtons
                  machineId={m.id}
                  ownership={m.ownership}
                />
              ) : (
                <span className="text-xs text-ink-3">—</span>
              )}
            </TD>
          </TRow>
        );
      })}
    </>
  );
}
