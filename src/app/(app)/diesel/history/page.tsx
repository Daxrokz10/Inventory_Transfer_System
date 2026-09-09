import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import { fetchSiteHistory, type SiteStay } from "@/lib/diesel/history";

const SOURCE_LABEL: Record<SiteStay["source"], string> = {
  logged: "from fuel logs",
  transferred: "recorded transfer",
  inferred: "no activity — assumed unchanged",
};
const SOURCE_TONE: Record<SiteStay["source"], "good" | "accent" | "warn"> = {
  logged: "good",
  transferred: "accent",
  inferred: "warn",
};

function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(y, m, 0).toISOString().slice(0, 10);
  return { start, end };
}

export default async function SiteHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; site?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  if (!isAdmin) redirect("/diesel");

  const isMonth = (s?: string) => !!s && /^\d{4}-\d{2}$/.test(s);
  const month = isMonth(sp.month) ? sp.month! : new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(month);
  const siteFilter = sp.site || null;

  const [{ data: projects }, rows] = await Promise.all([
    supabase.from("projects").select("id, name, code").order("name"),
    fetchSiteHistory(supabase, start, end, siteFilter),
  ]);

  const movedCount = rows.filter((r) => r.stays.length > 1).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site History"
        subtitle="Which vehicles were on which site, month by month"
      />

      <form className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Month
          <Input type="month" name="month" defaultValue={month} className="min-w-40" />
        </label>
        <Select name="site" defaultValue={siteFilter ?? ""} className="min-w-56">
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
      </form>

      <p className="text-sm text-ink-3">
        {rows.length} machine{rows.length === 1 ? "" : "s"} with a known site this month
        {movedCount > 0 && <> · {movedCount} moved sites during the month</>}. Site for a month
        comes from that machine&apos;s own fuel logs where it has any — see the badges below for
        how less certain months are marked.
      </p>

      <Card className="overflow-x-auto p-0">
        <Table>
          <thead>
            <tr>
              <TH>Machine</TH>
              <TH>Type</TH>
              <TH>Site(s) this month</TH>
              <TH>How we know</TH>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <TD colSpan={4}>
                  <EmptyState message={`No machines have a known site for ${month} yet.`} />
                </TD>
              </tr>
            ) : (
              rows.map((r) => (
                <TRow key={r.machine_id}>
                  <TD>
                    <span className="font-medium">{r.machine_name}</span>
                    {r.registration_no && <span className="text-ink-3"> · {r.registration_no}</span>}
                    {!r.is_active && (
                      <Badge tone="neutral" className="ml-2">
                        inactive
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-ink-2">{r.machine_type}</TD>
                  <TD>
                    <div className="flex flex-col gap-1">
                      {r.stays.map((s, i) => (
                        <div key={s.project_id + i} className="flex items-center gap-1.5">
                          <span className="font-medium">{s.site_label}</span>
                          {(s.from_date || s.to_date) && (
                            <span className="font-mono text-xs tabular-nums text-ink-3">
                              {s.from_date === s.to_date || !s.to_date
                                ? s.from_date
                                : `${s.from_date} → ${s.to_date}`}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-col gap-1">
                      {r.stays.map((s, i) => (
                        <Badge key={s.project_id + i} tone={SOURCE_TONE[s.source]}>
                          {SOURCE_LABEL[s.source]}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                </TRow>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
