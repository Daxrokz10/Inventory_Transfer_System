import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { TD, TH, TRow, Table } from "@/components/ui/Table";
import { getHrContext } from "@/lib/hr/auth";
import { fmtDateTime, statusTone } from "@/lib/hr/format";
import { listPeople } from "@/lib/hr/people";

type Search = { state?: string; interviewer?: string };

type Row = {
  id: string;
  panel_id: string;
  round: number;
  scheduled_at: string | null;
  mode: string | null;
  state: "assigned" | "completed" | "cancelled";
  interviewer_id: string;
  created_at: string;
  candidate: { id: string; name: string; designation: string | null; status: string | null } | null;
};

export default async function InterviewsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase } = await getHrContext("staff");
  const sp = await searchParams;
  const state = sp.state ?? "pending";

  const [{ data }, people] = await Promise.all([
    supabase
      .from("hr_interviews")
      .select("id, panel_id, round, scheduled_at, mode, state, interviewer_id, created_at, candidate:candidate_id(id, name, designation, status)")
      .order("created_at", { ascending: false })
      .limit(2000),
    listPeople(),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  // One line per panel (a round with one or more interviewers).
  const panels = new Map<string, Row[]>();
  for (const r of (data ?? []) as unknown as Row[]) panels.set(r.panel_id, [...(panels.get(r.panel_id) ?? []), r]);

  const lines = [...panels.values()]
    .map((rows) => {
      const live = rows.filter((r) => r.state !== "cancelled");
      const done = live.filter((r) => r.state === "completed").length;
      const panelState = live.length === 0 ? "cancelled" : done === live.length ? "completed" : "pending";
      return { head: rows[0], rows, live, done, panelState };
    })
    .filter((l) => state === "all" || l.panelState === state)
    .filter((l) => !sp.interviewer || l.rows.some((r) => r.interviewer_id === sp.interviewer))
    .sort((a, b) => {
      const at = a.head.scheduled_at ?? a.head.created_at;
      const bt = b.head.scheduled_at ?? b.head.created_at;
      return state === "pending" ? at.localeCompare(bt) : bt.localeCompare(at);
    });

  return (
    <div className="space-y-5">
      <PageHeader title="Interviews" subtitle="Every interview sent out, and the feedback that came back." />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <Select name="state" defaultValue={state}>
          <option value="pending">Awaiting feedback</option>
          <option value="completed">All feedback in</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </Select>
        <Select name="interviewer" defaultValue={sp.interviewer ?? ""}>
          <option value="">All interviewers</option>
          {people.filter((p) => p.canInterview).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">Apply</button>
        <Link href="/hr/interviews" className="px-2 py-2 text-sm text-ink-2 hover:underline">
          Reset
        </Link>
      </form>

      <Card className="overflow-x-auto p-0">
        {lines.length === 0 ? (
          <p className="p-6 text-sm text-ink-2">No interviews for this filter.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>When</TH>
                <TH>Candidate</TH>
                <TH>Round</TH>
                <TH>Interviewers</TH>
                <TH>Feedback</TH>
                <TH>Candidate status</TH>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ head, rows, live, done, panelState }) => (
                <TRow key={head.panel_id}>
                  <TD className="whitespace-nowrap text-ink-2">
                    {fmtDateTime(head.scheduled_at)}
                    {head.mode && <p className="text-xs text-ink-3">{head.mode}</p>}
                  </TD>
                  <TD>
                    {head.candidate ? (
                      <Link href={`/hr/candidates/${head.candidate.id}`} className="font-medium text-accent hover:underline">
                        {head.candidate.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                    <p className="text-xs text-ink-3">{head.candidate?.designation ?? ""}</p>
                  </TD>
                  <TD className="text-ink-2">{head.round}</TD>
                  <TD className="text-sm">
                    {rows.map((r) => (
                      <span key={r.id} className={r.state === "cancelled" ? "block text-ink-3 line-through" : "block text-ink"}>
                        {r.state === "completed" ? "✓ " : ""}
                        {nameOf.get(r.interviewer_id) ?? "—"}
                      </span>
                    ))}
                  </TD>
                  <TD>
                    {panelState === "cancelled" ? (
                      <Badge>Cancelled</Badge>
                    ) : (
                      <Badge tone={panelState === "completed" ? "good" : "warn"}>
                        {done} of {live.length}
                      </Badge>
                    )}
                  </TD>
                  <TD>
                    {head.candidate?.status ? <Badge tone={statusTone(head.candidate.status)}>{head.candidate.status}</Badge> : "—"}
                  </TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
