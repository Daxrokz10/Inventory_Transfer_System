import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardLabel } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import { buildDieselRegister } from "@/lib/diesel/register";
import { monthRange } from "@/lib/diesel/monthlyReport";
import { OpeningStockForm } from "./OpeningStockForm";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const L = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`;

export default async function DieselRegisterPage({
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
    ? await supabase.from("profiles").select("role, home_project_id").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  const homeProjectId = profile?.home_project_id ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);

  // Admin picks a site; supervisors are pinned to their own.
  const { data: siteList } = isAdmin
    ? await supabase.from("projects").select("id, name, code").eq("is_active", true).order("code")
    : { data: null };
  const projectId = isAdmin ? (sp.site || null) : homeProjectId;

  if (!projectId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Diesel Register" subtitle="Barrel stock ledger — inward, outward and running balance" />
        <Card>
          <p className="text-sm text-ink-2">
            {isAdmin ? "Pick a site to view its diesel register." : "Your account isn’t assigned to a site yet."}
          </p>
          {isAdmin && (
            <form className="mt-3 flex flex-wrap items-end gap-2">
              <Select name="site" defaultValue="" className="min-w-56">
                <option value="" disabled>
                  Select site…
                </option>
                {(siteList ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ? `${s.code} · ` : ""}
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary" size="sm">
                Open
              </Button>
            </form>
          )}
        </Card>
      </div>
    );
  }

  const { start, end } = monthRange(month);
  const [{ data: site }, { data: openingRaw }, register] = await Promise.all([
    supabase.from("projects").select("id, name, code").eq("id", projectId).single(),
    supabase.from("diesel_opening_stock").select("liters, as_of").eq("project_id", projectId).maybeSingle(),
    buildDieselRegister(supabase, projectId, { start, end }),
  ]);

  const opening = openingRaw ? { liters: Number(openingRaw.liters), as_of: openingRaw.as_of } : null;
  const exportHref = `/diesel/register/export?site=${projectId}&month=${month}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diesel Register"
        subtitle={
          <>
            {site?.code ? `${site.code} · ` : ""}
            {site?.name ?? "—"} — inward, outward &amp; running barrel balance
          </>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2">
          {isAdmin && (
            <Select name="site" defaultValue={projectId} className="min-w-52">
              {(siteList ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code ? `${s.code} · ` : ""}
                  {s.name}
                </option>
              ))}
            </Select>
          )}
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Month
            <Input type="month" name="month" defaultValue={month} className="min-w-40" />
          </label>
          <Button type="submit" variant="secondary" size="sm">
            Apply
          </Button>
          <a href={exportHref}>
            <Button type="button" size="sm">
              Download CSV
            </Button>
          </a>
        </form>
        <OpeningStockForm projectId={projectId} current={opening} today={today} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card>
          <CardLabel>Brought forward</CardLabel>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums">{L(register.broughtForward)}</p>
        </Card>
        <Card>
          <CardLabel>Inward · {month}</CardLabel>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-good">+{L(register.inwardLiters)}</p>
          {register.inwardAmount > 0 && <p className="mt-1 text-xs text-ink-3">{inr(register.inwardAmount)}</p>}
        </Card>
        <Card>
          <CardLabel>Outward · {month}</CardLabel>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-danger">−{L(register.outwardLiters)}</p>
        </Card>
        <Card>
          <CardLabel>Closing balance</CardLabel>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums">{L(register.closingBalance)}</p>
        </Card>
        <Card>
          <CardLabel>Opening anchor</CardLabel>
          <p className="mt-2 text-sm text-ink-2">
            {opening ? (
              <>
                {L(opening.liters)}
                <span className="block text-xs text-ink-3">as of {opening.as_of}</span>
              </>
            ) : (
              <span className="text-warn">not set</span>
            )}
          </p>
        </Card>
      </div>

      <Card className="overflow-x-auto p-0">
        <Table>
          <thead>
            <tr>
              <TH>Date</TH>
              <TH>Type</TH>
              <TH>Party / Machine</TH>
              <TH className="text-right">In (L)</TH>
              <TH className="text-right">Out (L)</TH>
              <TH className="text-right">Reading</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Balance (L)</TH>
            </tr>
          </thead>
          <tbody>
            {register.rows.length === 0 ? (
              <tr>
                <TD colSpan={9}>
                  <EmptyState message={`No diesel movements recorded for ${month}.`} />
                </TD>
              </tr>
            ) : (
              register.rows.map((r, i) => (
                <TRow key={i} className={r.type === "INWARD" ? "bg-good-soft/30" : undefined}>
                  <TD className="whitespace-nowrap">{r.date}</TD>
                  <TD>
                    {r.type === "INWARD" ? (
                      <Badge tone="good">Inward</Badge>
                    ) : (
                      <Badge tone={r.subGroup === "EXTERNAL" ? "warn" : "neutral"}>
                        Out · {r.subGroup === "EXTERNAL" ? "hired" : "own"}
                      </Badge>
                    )}
                  </TD>
                  <TD>
                    {r.type === "INWARD" ? (
                      <span className="text-ink-2">{r.party}</span>
                    ) : (
                      <>
                        <span className="font-medium">{r.machine}</span>
                        {r.assetCode && <span className="text-ink-3"> · {r.assetCode}</span>}
                      </>
                    )}
                  </TD>
                  <TD className="text-right font-mono tabular-nums text-good">
                    {r.type === "INWARD" ? r.liters.toFixed(1) : ""}
                  </TD>
                  <TD className="text-right font-mono tabular-nums text-danger">
                    {r.type === "OUTWARD" ? r.liters.toFixed(1) : ""}
                  </TD>
                  <TD className="text-right font-mono tabular-nums text-ink-2">
                    {r.type === "OUTWARD"
                      ? r.meterBroken
                        ? "stop"
                        : r.startReading != null && r.endReading != null
                          ? `${r.startReading} → ${r.endReading}`
                          : "—"
                      : ""}
                  </TD>
                  <TD className="text-right font-mono tabular-nums text-ink-2">
                    {r.rate != null ? r.rate.toFixed(2) : ""}
                  </TD>
                  <TD className="text-right font-mono tabular-nums text-ink-2">
                    {r.amount != null ? inr(r.amount) : ""}
                  </TD>
                  <TD className="text-right font-mono tabular-nums font-medium">
                    {r.runningBalance.toFixed(1)}
                  </TD>
                </TRow>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <p className="text-xs text-ink-3">
        Running balance = opening stock + inward − outward. It’s a shown figure, not an alarm — its
        accuracy depends on every barrel and every machine fill being logged. A drift from the
        physical count means something wasn’t entered (or leaked); re-set the opening stock after a
        fresh count to re-anchor it.
      </p>
    </div>
  );
}
