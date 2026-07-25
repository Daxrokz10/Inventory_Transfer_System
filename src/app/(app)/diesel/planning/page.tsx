import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { StatusPill } from "@/components/ui/states";
import type { Machine, SiteRequirement } from "@/lib/diesel/types";
import {
  recommend,
  fleetOwnVsRent,
  STANDING_RENTAL_SOURCE,
  type Recommendation,
  type SiteMeta,
  type OwnVsRentRow,
  type RelocationTier,
} from "@/lib/diesel/planning";
import { RequirementForm } from "./RequirementForm";
import { RequirementResolveControls } from "./RequirementResolveControls";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default async function PlanningPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  if (!isAdmin) redirect("/diesel");

  const [{ data: reqRaw }, { data: machinesRaw }, { data: sites }] = await Promise.all([
    supabase
      .from("site_requirements")
      .select("*")
      .order("needed_from", { ascending: true }),
    supabase.from("machines").select("*"),
    supabase
      .from("projects")
      .select("id, name, code, state, city")
      .eq("is_active", true)
      .order("name"),
  ]);

  const requirements = (reqRaw ?? []) as SiteRequirement[];
  const machines = (machinesRaw ?? []) as Machine[];
  const siteList = (sites ?? []) as {
    id: string;
    name: string;
    code: string | null;
    state: string | null;
    city: string | null;
  }[];
  const siteName = new Map(siteList.map((s) => [s.id, s.name]));
  const siteCode = new Map(siteList.map((s) => [s.id, s.code]));
  const siteMeta = new Map<string, SiteMeta>(
    siteList.map((s) => [s.id, { state: s.state, city: s.city }]),
  );

  const open = requirements.filter((r) => r.status === "open");
  const resolved = requirements.filter((r) => r.status !== "open");

  const recs: Recommendation[] = open.map((r) => recommend(r, machines, siteCode, siteMeta));
  const fleet = fleetOwnVsRent(machines);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planning"
        subtitle="Upcoming machine requirements, matched against the fleet's SO end dates and the rent-vs-buy cost table"
      />

      <RequirementForm sites={siteList} />

      <FleetOwnVsRentPanel rows={fleet} />

      <h2 className="font-display text-sm font-semibold uppercase tracking-[0.1em] text-ink-3">
        Open requirements
      </h2>

      {open.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-2">
            No open requirements. Add one above to get a supply match and a rent/buy
            recommendation.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {recs.map((rec) => (
            <RequirementCard
              key={rec.requirement.id}
              rec={rec}
              siteName={siteName}
              siteCode={siteCode}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <Card className="p-0">
          <h2 className="border-b border-line px-5 py-3 font-display text-sm font-semibold uppercase tracking-wide">
            Resolved
          </h2>
          <ul className="divide-y divide-line">
            {resolved.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
              >
                <span className="text-ink-2">
                  <span className="font-medium text-ink">
                    {r.quantity}× {r.machine_type}
                  </span>{" "}
                  · {siteName.get(r.project_id) ?? "—"} · {fmtDate(r.needed_from)}
                  {r.needed_until ? ` → ${fmtDate(r.needed_until)}` : " (open-ended)"}
                </span>
                <Badge tone={r.status === "fulfilled" ? "good" : "neutral"}>
                  {r.status}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="font-mono text-[11px] text-ink-3">
        Rent/buy figures — MONTHLY REVENUE TO COST.xlsx, &quot;RENTAL VS NEW&quot; tab,
        June 2026.
      </p>
    </div>
  );
}

function FleetOwnVsRentPanel({ rows }: { rows: OwnVsRentRow[] }) {
  const buys = rows.filter((r) => r.call === "buy-strong");
  const totalBuyRent = buys.reduce((s, r) => s + r.externalMonthlyRent * 12, 0);

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.1em]">
          Own vs rent — fleet-wide
        </h2>
        <p className="text-xs text-ink-3">
          What the company rents <em>every month</em>, across all sites — the real buy signal
        </p>
      </div>

      {buys.length > 0 && (
        <div className="border-b border-line bg-danger-soft px-5 py-3 text-sm text-danger">
          <strong>
            {buys.length} type{buys.length === 1 ? "" : "s"} worth owning
          </strong>{" "}
          — you rent {buys.map((b) => b.machineType.replace(/ \(.*\)/, "")).join(", ")} in volume
          every month from outside vendors ({inr(totalBuyRent)}/yr, excl. Shraddha), and each pays
          back well inside its life. Buying the standing base beats renting it forever.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-ink-3">
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium">Rented / mo</th>
              <th className="px-4 py-2 text-right font-medium">Own now</th>
              <th className="px-4 py-2 text-right font-medium">Rent / yr (ext.)</th>
              <th className="px-4 py-2 text-right font-medium">Buy each</th>
              <th className="px-4 py-2 text-right font-medium">Payback</th>
              <th className="px-4 py-2 font-medium">Call</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.machineType} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium text-ink">{r.machineType}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {r.shraddhaUnits > 0 ? (
                    <>
                      {r.externalUnits}
                      <span className="text-ink-3"> ext. + {r.shraddhaUnits} Shraddha</span>
                    </>
                  ) : (
                    r.unitsRented
                  )}
                  <span className="text-ink-3"> · {r.sites} sites</span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-2">
                  {r.ownedNow}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {inr(r.externalMonthlyRent * 12)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-2">
                  {r.cost ? inr(r.cost.purchasePrice) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-2">
                  {r.perUnitPaybackMonths != null ? `${r.perUnitPaybackMonths} mo` : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <OwnVsRentCallPill call={r.call} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-2 font-mono text-[11px] text-ink-3">
        Source: {STANDING_RENTAL_SOURCE}. Payback = buy price ÷ average rent we actually pay
        outside vendors for this type — Shraddha (SGC's sister company) is excluded from the
        rent figures and the call, since paying them isn't real market dependency. Types with no
        buy price show the rent as an unpriced opportunity.
      </p>
    </Card>
  );
}

function OwnVsRentCallPill({ call }: { call: OwnVsRentRow["call"] }) {
  if (call === "buy-strong") return <StatusPill tone="alarm">Buy the base</StatusPill>;
  if (call === "buy-consider") return <StatusPill tone="caution">Consider buying</StatusPill>;
  if (call === "rent") return <StatusPill tone="ok">Keep renting</StatusPill>;
  return <StatusPill tone="off">No buy price</StatusPill>;
}

const RELOCATION_LABEL: Record<RelocationTier, { label: string; tone: "ok" | "caution" | "alarm" | "off" }> = {
  local: { label: "local", tone: "ok" },
  "in-state": { label: "in-state", tone: "ok" },
  "cross-state": { label: "cross-state move", tone: "caution" },
  unknown: { label: "distance ?", tone: "off" },
};

function RequirementCard({
  rec,
  siteName,
  siteCode,
}: {
  rec: Recommendation;
  siteName: Map<string, string>;
  siteCode: Map<string, string | null>;
}) {
  const { requirement: r, candidates, durationMonths, verdict } = rec;
  const usedIds = new Set(
    verdict.kind === "reassign" || verdict.kind === "reassign-with-gap"
      ? verdict.used.map((c) => c.machine.id)
      : [],
  );

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold uppercase tracking-wide text-ink">
            {r.quantity}× {r.machine_type}
          </p>
          <p className="mt-0.5 text-sm text-ink-2">
            {siteCode.get(r.project_id) && (
              <span className="font-mono text-xs text-ink-3">
                {siteCode.get(r.project_id)} ·{" "}
              </span>
            )}
            {siteName.get(r.project_id) ?? "—"} · needed from{" "}
            <span className="font-mono">{fmtDate(r.needed_from)}</span>
            {r.needed_until ? (
              <>
                {" "}
                to <span className="font-mono">{fmtDate(r.needed_until)}</span>
              </>
            ) : (
              " · open-ended"
            )}
            {durationMonths != null && (
              <span className="text-ink-3"> ({durationMonths} mo)</span>
            )}
          </p>
          {r.note && <p className="mt-1 text-sm text-ink-3">&ldquo;{r.note}&rdquo;</p>}
        </div>
        <RequirementResolveControls requirementId={r.id} />
      </div>

      <VerdictBanner verdict={verdict} />

      {candidates.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-2 text-left uppercase tracking-wide text-ink-3">
                <th className="px-3 py-2 font-medium">Machine</th>
                <th className="px-3 py-2 font-medium">Current site</th>
                <th className="px-3 py-2 font-medium">Availability</th>
                <th className="px-3 py-2 font-medium">Move</th>
                <th className="px-3 py-2 text-right font-medium">Frees</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const reloc = RELOCATION_LABEL[c.relocation];
                return (
                  <tr
                    key={c.machine.id}
                    className={`border-t border-line ${usedIds.has(c.machine.id) ? "bg-good-soft/40" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium text-ink">{c.machine.name}</td>
                    <td className="px-3 py-2 text-ink-2">
                      {siteName.get(c.machine.project_id) ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <AvailabilityPill availability={c.availability} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tone={reloc.tone}>{reloc.label}</StatusPill>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-2">
                      {c.machine.so_until ? fmtDate(c.machine.so_until) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AvailabilityPill({
  availability,
}: {
  availability: Recommendation["candidates"][number]["availability"];
}) {
  if (availability === "idle-now") return <StatusPill tone="ok">Idle now</StatusPill>;
  if (availability === "frees-in-time")
    return <StatusPill tone="ok">Frees in time</StatusPill>;
  if (availability === "frees-late")
    return <StatusPill tone="caution">Frees too late</StatusPill>;
  return <StatusPill tone="off">No visibility</StatusPill>;
}

function VerdictBanner({ verdict }: { verdict: Recommendation["verdict"] }) {
  const crossStateMove =
    (verdict.kind === "reassign" || verdict.kind === "reassign-with-gap") &&
    verdict.used.some((c) => c.relocation === "cross-state");

  if (verdict.kind === "reassign") {
    return (
      <div className="rounded-md border border-good/30 bg-good-soft px-4 py-3 text-sm text-good">
        <strong>Reassign.</strong> {verdict.used.length} internal machine
        {verdict.used.length === 1 ? " is" : "s are"} already idle or free before the start
        date — no rent, no purchase needed.
        {crossStateMove && (
          <span className="mt-1 block text-warn">
            Heads up: at least one is a cross-state move — factor trucking cost/time; a short need
            may be cheaper to rent locally.
          </span>
        )}
      </div>
    );
  }
  if (verdict.kind === "reassign-with-gap") {
    return (
      <div className="rounded-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
        <strong>Reassign, with a gap.</strong> The fleet covers this, but the last machine
        doesn&apos;t free up until {verdict.gapDays} day{verdict.gapDays === 1 ? "" : "s"} after
        the start date — rent externally for that gap, then swap the internal machine in.
        {crossStateMove && (
          <span className="mt-1 block">
            One is a cross-state move — factor trucking cost/time before committing.
          </span>
        )}
      </div>
    );
  }
  if (verdict.kind === "rent") {
    return (
      <div className="rounded-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
        <strong>Rent.</strong> {verdict.shortfall} machine{verdict.shortfall === 1 ? "" : "s"}{" "}
        short and no internal one frees in time. At{" "}
        <span className="font-mono">{inr(verdict.cost.monthlyRent)}/mo</span>, renting is
        cheaper than buying (<span className="font-mono">{inr(verdict.cost.purchasePrice)}</span>{" "}
        breaks even at {verdict.cost.breakevenLabel} — shorter than this need).
      </div>
    );
  }
  if (verdict.kind === "buy") {
    return (
      <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        <strong>Consider buying.</strong> {verdict.shortfall} machine
        {verdict.shortfall === 1 ? "" : "s"} short, none freeing up internally. This need
        runs {verdict.cost.breakevenLabel} or longer, which is where{" "}
        <span className="font-mono">{inr(verdict.cost.purchasePrice)}</span> to buy pays back
        against <span className="font-mono">{inr(verdict.cost.monthlyRent)}/mo</span> rent.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
      <strong className="text-ink">Short {verdict.shortfall}.</strong> No internal machine
      frees in time, and there&apos;s no rent/buy cost data for this type yet — rent or buy is
      a judgment call for now.
    </div>
  );
}
