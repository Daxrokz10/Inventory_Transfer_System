import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { TD, TH, TRow, Table } from "@/components/ui/Table";
import { getHrContext } from "@/lib/hr/auth";
import { OPENING_STATUS_TONE as STATUS_TONE } from "@/lib/hr/format";
import { OPENING_STATUS_LABEL, PRIORITY_LABEL, getStages } from "@/lib/hr/data";
import { createAdminClient } from "@/lib/supabase/admin";

type Search = { status?: string };

const PRIORITY_TONE: Record<string, BadgeTone> = { low: "neutral", normal: "neutral", high: "warn", urgent: "danger" };

export default async function OpeningsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase, access, user } = await getHrContext("planning");
  const sp = await searchParams;
  const status = sp.status ?? "all";

  // RLS: HR staff see every opening, planning users only their own.
  let query = supabase
    .from("hr_openings")
    .select("id, code, designation, headcount, required_by, priority, status, acknowledged_at, raised_by, created_at, project:project_id(code, name)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (status === "active") query = query.in("status", ["open", "in_progress"]);
  else if (status !== "all") query = query.eq("status", status);
  if (!access.hrStaff) query = query.eq("raised_by", user.id);

  const [{ data }, stages] = await Promise.all([query, getStages()]);
  type Row = {
    id: string;
    code: string;
    designation: string;
    headcount: number;
    required_by: string | null;
    priority: string;
    status: string;
    acknowledged_at: string | null;
    raised_by: string | null;
    created_at: string;
    project: { code: string; name: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  // Progress per opening. Planning users can't read candidates, so counts come
  // through the service role, limited to the openings already visible here.
  const admin = createAdminClient();
  const ids = rows.map((r) => r.id);
  const [{ data: counts }, { data: people }] = await Promise.all([
    ids.length
      ? admin.from("hr_opening_status_counts").select("opening_id, status, n").in("opening_id", ids)
      : Promise.resolve({ data: [] as { opening_id: string; status: string | null; n: number }[] }),
    admin.from("profiles").select("id, full_name"),
  ]);
  const kindOf = new Map(stages.map((s) => [s.name, s.kind]));
  const progress = new Map<string, { total: number; filled: number }>();
  for (const c of counts ?? []) {
    const p = progress.get(c.opening_id) ?? { total: 0, filled: 0 };
    p.total += c.n;
    if (c.status && kindOf.get(c.status) === "success") p.filled += c.n;
    progress.set(c.opening_id, p);
  }
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name ?? "—"]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Openings"
        subtitle={access.hrStaff ? "Positions raised by planning, and how hiring is going." : "Positions you have raised and their progress."}
        actions={
          access.planning && (
            <Link
              href="/hr/openings/new"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
            >
              + Raise opening
            </Link>
          )
        }
      />

      <form method="get" className="flex items-end gap-3">
        <Select name="status" defaultValue={status}>
          <option value="all">All openings</option>
          <option value="active">Open & in progress</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="filled">Filled</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">Apply</button>
      </form>

      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-2">No openings here.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>Code</TH>
                <TH>Post</TH>
                <TH>Site</TH>
                <TH>Needed</TH>
                <TH>By</TH>
                <TH>Priority</TH>
                <TH>Candidates</TH>
                <TH>Status</TH>
                <TH>Raised by</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = progress.get(r.id) ?? { total: 0, filled: 0 };
                return (
                  <TRow key={r.id}>
                    <TD className="whitespace-nowrap font-mono text-xs">
                      <Link href={`/hr/openings/${r.id}`} className="text-accent hover:underline">
                        {r.code}
                      </Link>
                      {access.hrStaff && !r.acknowledged_at && (
                        <Badge tone="danger" className="ml-2">
                          New
                        </Badge>
                      )}
                    </TD>
                    <TD className="font-medium">{r.designation}</TD>
                    <TD className="text-ink-2">{r.project?.code ?? "—"}</TD>
                    <TD className="tabular-nums">
                      {p.filled}/{r.headcount}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-2">
                      {r.required_by ? new Date(r.required_by).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                    </TD>
                    <TD>
                      <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>
                    </TD>
                    <TD className="tabular-nums text-ink-2">{p.total}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[r.status]}>{OPENING_STATUS_LABEL[r.status]}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-ink-2">{r.raised_by ? nameOf.get(r.raised_by) : "—"}</TD>
                  </TRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
