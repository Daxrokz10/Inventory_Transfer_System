import Link from "next/link";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import type { FleetUtilization, MachineUtil, Verdict } from "@/lib/diesel/utilization";

/* The Planning page's utilization section: what to act on first (sorted by
   money), how each machine type is doing, and every machine with the
   reasoning behind its verdict. Pure presentation — all the analysis lives
   in lib/diesel/utilization.ts. */

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const VERDICT: Record<Verdict, { label: string; tone: BadgeTone }> = {
  gone: { label: "Probably returned", tone: "danger" },
  release: { label: "Release", tone: "danger" },
  review: { label: "Review", tone: "warn" },
  keep: { label: "Keep", tone: "good" },
  redeploy: { label: "Move it", tone: "accent" },
  underused: { label: "Underused", tone: "warn" },
  insufficient: { label: "Too new to judge", tone: "neutral" },
  untracked: { label: "Not tracked", tone: "neutral" },
  removed: { label: "Removed", tone: "neutral" },
};

export interface UtilFilters {
  verdict: string;
  ownership: string;
  type: string;
  site: string;
  q: string;
}

export function FleetUtilizationSection({
  data,
  siteCode,
  siteName,
  filters,
  unpricedTypes,
}: {
  data: FleetUtilization;
  siteCode: Map<string, string | null>;
  siteName: Map<string, string>;
  filters: UtilFilters;
  /** Hired types with no rate on record — their savings can't be sized. */
  unpricedTypes: string[];
}) {
  const active = data.machines.filter((r) => r.machine.is_active);
  const hired = active.filter((r) => r.machine.ownership === "external");
  const sum = (rs: MachineUtil[]) => rs.reduce((s, r) => s + (r.monthlySaving ?? 0), 0);

  const gone = hired.filter((r) => r.verdict === "gone").sort(bySaving);
  const release = hired.filter((r) => r.verdict === "release").sort(bySaving);
  const redeploy = [...data.redeployments].sort((a, b) => (b.monthlySaving ?? 0) - (a.monthlySaving ?? 0));
  const ownIdle = active.filter((r) => r.machine.ownership === "internal" && (r.verdict === "underused" || r.verdict === "redeploy"));

  const hiredRent = hired.reduce((s, r) => s + (r.monthlyRent ?? 0), 0);
  const unpricedHired = hired.filter((r) => r.monthlyRent == null).length;
  const redeploySaving = redeploy.reduce((s, d) => s + (d.monthlySaving ?? 0), 0);

  const label = (siteId: string) => siteCode.get(siteId) ?? siteName.get(siteId) ?? "—";

  // ---- All-machines table, filtered by the GET form below
  const q = filters.q.trim().toLowerCase();
  const rows = data.machines
    .filter((r) => (filters.verdict ? r.verdict === filters.verdict : r.verdict !== "removed"))
    .filter((r) => !filters.ownership || r.machine.ownership === filters.ownership)
    .filter((r) => !filters.type || r.machine.machine_type === filters.type)
    .filter((r) => !filters.site || r.siteId === filters.site)
    .filter(
      (r) =>
        !q ||
        [r.machine.name, r.machine.registration_no, r.machine.vendor_name, r.machine.machine_type, label(r.siteId)]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
    )
    .sort((a, b) => (b.monthlySaving ?? 0) - (a.monthlySaving ?? 0) || (a.utilization ?? 999) - (b.utilization ?? 999));

  const types = [...new Set(data.machines.map((r) => r.machine.machine_type))].sort();
  const sites = [...new Set(data.machines.map((r) => r.siteId))].sort((a, b) => label(a).localeCompare(label(b)));

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.1em] text-ink-3">
          Fleet utilization
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          How hard every machine actually works, measured from its meter readings (or fuel drawn,
          where the meter is broken), compared with others of the same type. Hired machines that
          aren&apos;t earning their rent, and own machines sitting idle while the same type is being
          rented elsewhere, are listed first — biggest saving at the top.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat
          label="Hired, active"
          value={String(hired.length)}
          sub={`${inr(hiredRent)}/mo${unpricedHired ? ` · ${unpricedHired} unpriced` : ""}`}
        />
        <Stat
          label="Probably returned"
          value={String(gone.length)}
          sub={`${inr(sum(gone))}/mo still on the books`}
          tone="danger"
        />
        <Stat label="Release" value={String(release.length)} sub={`saves ${inr(sum(release))}/mo`} tone="danger" />
        <Stat
          label="Move own, off-hire rental"
          value={String(redeploy.length)}
          sub={`saves ${inr(redeploySaving)}/mo`}
          tone="accent"
        />
        <Stat label="Own machines idle / light use" value={String(ownIdle.length)} sub="see Underused below" />
      </div>

      {unpricedTypes.length > 0 && (
        <p className="rounded-md border border-warn/30 bg-warn-soft px-4 py-2 text-sm text-warn">
          No hire rate on record for: {unpricedTypes.join(", ")}. Savings for those machines show as
          &quot;—&quot; until a rate is set, so the totals above understate them.
        </p>
      )}

      {gone.length > 0 && (
        <ActionCard
          title="Probably already returned — confirm, then remove"
          blurb="No fuel or meter reading for 30+ days. These have most likely gone back to the vendor without being removed here, so they still count as hired. If one is actually still on site, it's standing idle on rent — release it."
        >
          <MiniTable rows={gone} label={label} showLastSeen />
        </ActionCard>
      )}

      {release.length > 0 && (
        <ActionCard
          title="Release — not earning their rent"
          blurb="Working well below others of the same type, or not fuelled in 10+ days. Check with the site first: a machine kept on standby for a specific job may be worth its rent anyway."
        >
          <MiniTable rows={release} label={label} />
        </ActionCard>
      )}

      {redeploy.length > 0 && (
        <ActionCard
          title="Move an own machine, off-hire a rental"
          blurb="An own machine is idle or barely used while the same type is being rented at another site. Moving it there and returning the rental is the cheapest saving available — same-state moves first."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-3 py-2 font-medium">Own machine (idle)</th>
                  <th className="px-3 py-2 font-medium">Replaces rental</th>
                  <th className="px-3 py-2 font-medium">Move</th>
                  <th className="px-3 py-2 text-right font-medium">Saves / mo</th>
                </tr>
              </thead>
              <tbody>
                {redeploy.map((d) => (
                  <tr key={d.own.machine.id} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      <MachineLink r={d.own} />
                      <span className="block text-xs text-ink-3">
                        {label(d.own.siteId)} ·{" "}
                        {d.own.daysSinceActive >= 10
                          ? `idle ${d.own.daysSinceActive} days`
                          : `${d.own.utilization ?? "—"}% used`}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <MachineLink r={d.rental} />
                      <span className="block text-xs text-ink-3">
                        {label(d.rental.siteId)} · {d.rental.machine.vendor_name ?? "vendor ?"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-2">{d.sameState ? "same state" : "other state"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {d.monthlySaving != null ? inr(d.monthlySaving) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionCard>
      )}

      <Card className="p-0">
        <div className="border-b border-line px-5 py-3">
          <h3 className="font-display text-sm font-semibold uppercase tracking-[0.1em]">By machine type</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            Utilization is each machine&apos;s work per day against the 75th percentile of its type —
            what a well-used unit of that type does.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Hired</th>
                <th className="px-4 py-2 text-right font-medium">Own</th>
                <th className="px-4 py-2 text-right font-medium">Typical use / day</th>
                <th className="px-4 py-2 text-right font-medium">Avg utilization</th>
                <th className="px-4 py-2 text-right font-medium">Rent / mo</th>
                <th className="px-4 py-2 font-medium">Verdicts</th>
              </tr>
            </thead>
            <tbody>
              {data.types.map((t) => (
                <tr key={t.machineType} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium">
                    <Link
                      href={`?type=${encodeURIComponent(t.machineType)}#machines`}
                      className="text-ink hover:text-accent hover:underline"
                    >
                      {t.machineType}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{t.hired || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-2">{t.own || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-2">
                    {t.medianPerDay != null && t.unit !== "mixed"
                      ? `${t.medianPerDay.toFixed(t.unit === "hr" ? 1 : 0)} ${t.unit === "L" ? "L" : t.unit}`
                      : t.unit === "mixed"
                        ? "mixed meters"
                        : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <UtilBar value={t.avgUtilization} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {t.hired ? inr(t.monthlyRent) : "—"}
                    {t.unpricedHired > 0 && (
                      <span className="ml-1 font-sans text-[10px] text-warn">{t.unpricedHired} unpriced</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(Object.keys(t.verdicts) as Verdict[])
                        .filter((v) => t.verdicts[v] > 0 && v !== "removed")
                        .map((v) => (
                          <Badge key={v} tone={VERDICT[v].tone} className="px-1.5 py-0 text-[10px]">
                            {t.verdicts[v]} {VERDICT[v].label.toLowerCase()}
                          </Badge>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div id="machines" className="scroll-mt-4 space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-[0.1em] text-ink-3">
          Every machine
        </h3>
        <form className="flex flex-wrap items-end gap-2">
          <Select name="verdict" defaultValue={filters.verdict} className="min-w-40" aria-label="Verdict">
            <option value="">All verdicts</option>
            {(Object.keys(VERDICT) as Verdict[]).map((v) => (
              <option key={v} value={v}>
                {VERDICT[v].label}
              </option>
            ))}
          </Select>
          <Select name="ownership" defaultValue={filters.ownership} className="min-w-32" aria-label="Hired or own">
            <option value="">Hired + own</option>
            <option value="external">Hired</option>
            <option value="internal">Own</option>
          </Select>
          <Select name="type" defaultValue={filters.type} className="min-w-44" aria-label="Machine type">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select name="site" defaultValue={filters.site} className="min-w-44" aria-label="Site">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
          <Input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Machine, plate, vendor…"
            className="min-w-48"
            aria-label="Search"
          />
          <Button type="submit" variant="secondary" size="sm">
            Apply
          </Button>
          <Link href="/diesel/planning#machines" className="px-2 text-sm text-ink-3 hover:text-ink">
            Clear
          </Link>
        </form>

        <Card className="overflow-x-auto p-0">
          <Table>
            <thead>
              <tr>
                <TH>Machine</TH>
                <TH>Site · since</TH>
                <TH className="text-right">Use / day</TH>
                <TH>Utilization</TH>
                <TH className="text-right">Idle</TH>
                <TH className="text-right">Fuel</TH>
                <TH className="text-right">Rent / mo</TH>
                <TH className="text-right">Cost / unit</TH>
                <TH>Verdict</TH>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <TD colSpan={9}>
                    <EmptyState message="No machines match these filters." />
                  </TD>
                </tr>
              ) : (
                rows.map((r) => (
                  <TRow key={r.machine.id} className="align-top">
                    <TD>
                      <MachineLink r={r} />
                      <span className="block text-xs text-ink-3">
                        {r.machine.machine_type} ·{" "}
                        {r.machine.ownership === "external" ? (r.machine.vendor_name ?? "hired") : "own"}
                      </span>
                    </TD>
                    <TD className="text-ink-2">
                      {label(r.siteId)}
                      <span className="block font-mono text-xs text-ink-3">
                        {fmtDate(r.windowStart)} · {r.daysMeasured}d
                      </span>
                    </TD>
                    <TD className="text-right font-mono tabular-nums">
                      {r.perDay != null
                        ? `${r.perDay.toFixed(r.unit === "hr" ? 1 : 0)} ${r.unit}`
                        : "—"}
                      {r.basis === "fuel" && r.perDay != null && (
                        <span className="block font-sans text-[10px] text-ink-3">fuel-based</span>
                      )}
                    </TD>
                    <TD>
                      <UtilBar value={r.utilization} />
                      {r.peerPercentile != null && (
                        <span className="block text-[10px] text-ink-3">
                          busier than {r.peerPercentile}% of type
                        </span>
                      )}
                    </TD>
                    <TD className="text-right font-mono tabular-nums text-ink-2">
                      {r.machine.is_active && r.daysSinceActive > 0 ? `${r.daysSinceActive}d` : "—"}
                    </TD>
                    <TD className="text-right font-mono tabular-nums text-ink-2">
                      {r.fuelLiters > 0 ? `${Math.round(r.fuelLiters)} L` : "—"}
                    </TD>
                    <TD className="text-right font-mono tabular-nums">
                      {r.monthlyRent != null ? inr(r.monthlyRent) : r.machine.ownership === "external" ? "?" : "—"}
                    </TD>
                    <TD className="text-right font-mono tabular-nums text-ink-2">
                      {r.costPerUnit != null ? `${inr(r.costPerUnit)}/${r.unit}` : "—"}
                    </TD>
                    <TD className="max-w-80">
                      <Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Badge>
                      {r.reasons.length > 0 && (
                        <span className="mt-1 block text-xs leading-snug text-ink-3">{r.reasons.join(" · ")}</span>
                      )}
                    </TD>
                  </TRow>
                ))
              )}
            </tbody>
          </Table>
        </Card>
        <p className="font-mono text-[11px] text-ink-3">
          Work is measured from meter readings — a machine only logs when it fuels, so entry count
          isn&apos;t days worked. Meter jumps faster than 24 h or 800 km a day are treated as typos and
          skipped. The window starts when the machine was deployed or its site began logging,
          whichever is later. Cost / unit = (rent for the period + fuel) ÷ hours or km worked.
          &quot;Probably returned&quot; = hired with no fuel or reading for 30+ days.
        </p>
      </div>
    </section>
  );
}

function bySaving(a: MachineUtil, b: MachineUtil) {
  return (b.monthlySaving ?? 0) - (a.monthlySaving ?? 0) || b.daysSinceActive - a.daysSinceActive;
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "danger" | "accent";
}) {
  return (
    <Card>
      <CardLabel>{label}</CardLabel>
      <p
        className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${
          tone === "danger" ? "text-danger" : tone === "accent" ? "text-accent" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-ink-3">{sub}</p>
    </Card>
  );
}

function ActionCard({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <div className="border-b border-line px-5 py-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-[0.1em]">{title}</h3>
        <p className="mt-0.5 max-w-3xl text-xs text-ink-3">{blurb}</p>
      </div>
      {children}
    </Card>
  );
}

function MiniTable({
  rows,
  label,
  showLastSeen = false,
}: {
  rows: MachineUtil[];
  label: (siteId: string) => string;
  showLastSeen?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
            <th className="px-3 py-2 font-medium">Machine</th>
            <th className="px-3 py-2 font-medium">Site</th>
            <th className="px-3 py-2 font-medium">Why</th>
            <th className="px-3 py-2 text-right font-medium">{showLastSeen ? "Last seen" : "Rent / mo"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.machine.id} className="border-t border-line align-top">
              <td className="px-3 py-2">
                <MachineLink r={r} />
                <span className="block text-xs text-ink-3">
                  {r.machine.machine_type} · {r.machine.vendor_name ?? "vendor ?"}
                </span>
              </td>
              <td className="px-3 py-2 text-ink-2">{label(r.siteId)}</td>
              <td className="px-3 py-2 text-xs text-ink-3">{r.reasons.slice(0, 3).join(" · ")}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {showLastSeen ? (
                  <>
                    {r.daysSinceActive}d ago
                    <span className="block text-xs text-ink-3">
                      {r.monthlyRent != null ? `${inr(r.monthlyRent)}/mo` : "rent ?"}
                    </span>
                  </>
                ) : r.monthlyRent != null ? (
                  inr(r.monthlyRent)
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MachineLink({ r }: { r: MachineUtil }) {
  return (
    <Link href={`/diesel/machines/${r.machine.id}`} className="font-medium text-ink hover:text-accent hover:underline">
      {r.machine.name}
      {r.machine.registration_no && <span className="font-normal text-ink-3"> · {r.machine.registration_no}</span>}
    </Link>
  );
}

/** Utilization as a number plus a thin bar, capped visually at 100%. Colour
    carries the same band the verdicts use, with the number always shown so
    it never relies on colour alone. */
function UtilBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-ink-3">—</span>;
  const pct = Math.max(0, Math.min(100, value));
  const color = value < 35 ? "bg-danger" : value < 50 ? "bg-warn" : "bg-good";
  return (
    <span className="inline-flex min-w-24 items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs tabular-nums">{value}%</span>
    </span>
  );
}
