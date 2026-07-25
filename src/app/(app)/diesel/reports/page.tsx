import { Fragment } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardLabel } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import { fetchMonthlyReport, monthRange } from "@/lib/diesel/monthlyReport";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

export default async function DieselReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; site?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  if (!isAdmin) redirect("/diesel");

  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : new Date().toISOString().slice(0, 7);
  const siteFilter = sp.site || null;

  const { start, end } = monthRange(month);
  let receiptsQuery = supabase
    .from("fuel_receipts")
    .select("project_id, liters, total_cost")
    .gte("receipt_date", start)
    .lte("receipt_date", end);
  if (siteFilter) receiptsQuery = receiptsQuery.eq("project_id", siteFilter);

  const [{ data: projects }, rows, { data: receiptsRaw }] = await Promise.all([
    supabase.from("projects").select("id, name, code").eq("is_active", true).order("name"),
    fetchMonthlyReport(supabase, month, siteFilter),
    receiptsQuery,
  ]);

  const grandFuel = rows.reduce((s, r) => s + r.total_fuel, 0);
  const grandCost = rows.reduce((s, r) => s + r.total_cost, 0);
  const grandShraddhaFuel = rows.reduce((s, r) => s + r.shraddha_fuel, 0);
  const grandShraddhaCost = rows.reduce((s, r) => s + r.shraddha_cost, 0);

  // Diesel received (barrels arriving) — procurement, kept separate from the
  // consumption figures above so nothing double-counts. Keyed by site_label
  // to line up with the consumption groups.
  const projectLabel = new Map(
    (projects ?? []).map((p) => [p.id, p.code ? `${p.code} · ${p.name}` : p.name]),
  );
  const receivedByLabel = new Map<string, number>();
  let grandReceivedFuel = 0;
  for (const r of (receiptsRaw ?? []) as { project_id: string; liters: number }[]) {
    const label = projectLabel.get(r.project_id) ?? "—";
    receivedByLabel.set(label, (receivedByLabel.get(label) ?? 0) + Number(r.liters));
    grandReceivedFuel += Number(r.liters);
  }

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    (groups.get(r.site_label) ?? groups.set(r.site_label, []).get(r.site_label)!).push(r);
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const exportHref = `/diesel/reports/export?month=${month}${siteFilter ? `&site=${siteFilter}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monthly Diesel Report"
        subtitle="Per-site, per-machine consumption for a calendar month — for the monthly submission"
      />

      <form className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Month
          <Input type="month" name="month" defaultValue={month} className="min-w-40" />
        </label>
        <Select name="site" defaultValue={siteFilter ?? ""} className="min-w-48">
          <option value="">All sites</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code ? `${p.code} · ` : ""}
              {p.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
        <a href={exportHref}>
          <Button type="button" size="sm">
            Download CSV
          </Button>
        </a>
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardLabel>Fuel issued · {month}</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {grandFuel.toLocaleString("en-IN", { maximumFractionDigits: 0 })} L
          </p>
          {grandReceivedFuel > 0 && (
            <p className="mt-1 text-xs text-ink-3">
              {grandReceivedFuel.toLocaleString("en-IN", { maximumFractionDigits: 0 })} L received
              (barrels)
            </p>
          )}
        </Card>
        <Card>
          <CardLabel>Total cost · {month}</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {inr(grandCost)}
          </p>
          {grandShraddhaFuel > 0 && (
            <p className="mt-1 text-xs text-ink-3">
              incl. {grandShraddhaFuel.toLocaleString("en-IN", { maximumFractionDigits: 0 })} L
              / {inr(grandShraddhaCost)} from Shraddha pump
            </p>
          )}
        </Card>
        <Card>
          <CardLabel>Sites reporting</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {orderedGroups.length}
          </p>
        </Card>
        <Card>
          <CardLabel>Machines reporting</CardLabel>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {rows.length}
          </p>
        </Card>
      </div>

      <Card className="overflow-x-auto p-0">
        <Table>
          <thead>
            <tr>
              <TH>Machine</TH>
              <TH className="text-right">Opening</TH>
              <TH className="text-right">Closing</TH>
              <TH className="text-right">Fuel (L)</TH>
              <TH className="text-right">Cost</TH>
              <TH className="text-right">Days reported</TH>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <TD colSpan={6}>
                  <EmptyState message={`No daily reports for ${month} yet.`} />
                </TD>
              </tr>
            ) : (
              orderedGroups.map(([label, siteRows]) => {
                const siteFuel = siteRows.reduce((s, r) => s + r.total_fuel, 0);
                const siteCost = siteRows.reduce((s, r) => s + r.total_cost, 0);
                const siteShraddhaFuel = siteRows.reduce((s, r) => s + r.shraddha_fuel, 0);
                return (
                  <Fragment key={label}>
                    <tr className="bg-surface-2">
                      <td colSpan={6} className="border-y border-line px-4 py-2 text-sm font-semibold text-ink">
                        {label}
                        <span className="ml-2 text-xs font-normal text-ink-3">
                          {siteRows.length} machine{siteRows.length === 1 ? "" : "s"} ·{" "}
                          {siteFuel.toLocaleString("en-IN", { maximumFractionDigits: 0 })} L issued ·{" "}
                          {inr(siteCost)}
                          {(receivedByLabel.get(label) ?? 0) > 0 && (
                            <> · {receivedByLabel.get(label)!.toLocaleString("en-IN", { maximumFractionDigits: 0 })} L received</>
                          )}
                          {siteShraddhaFuel > 0 && (
                            <> · {siteShraddhaFuel.toLocaleString("en-IN", { maximumFractionDigits: 0 })} L from Shraddha pump</>
                          )}
                        </span>
                      </td>
                    </tr>
                    {siteRows.map((r) => (
                      <TRow key={r.machine_id}>
                        <TD>
                          <span className="font-medium">{r.machine_name}</span>
                          {r.registration_no && (
                            <span className="text-ink-3"> · {r.registration_no}</span>
                          )}
                        </TD>
                        <TD className="text-right font-mono tabular-nums">
                          {r.opening_reading ?? "—"}
                        </TD>
                        <TD className="text-right font-mono tabular-nums">
                          {r.closing_reading ?? "—"}
                        </TD>
                        <TD className="text-right font-mono tabular-nums">
                          {r.total_fuel.toFixed(1)}
                        </TD>
                        <TD className="text-right font-mono tabular-nums">{inr(r.total_cost)}</TD>
                        <TD className="text-right font-mono tabular-nums text-ink-2">
                          {r.days_reported}
                        </TD>
                      </TRow>
                    ))}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
