import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { TD, TH, TRow, Table } from "@/components/ui/Table";
import { RECOMMENDATION_LABEL, fmtDateTime, recommendationTone, statusTone } from "@/lib/hr/format";

export type InterviewListRow = {
  id: string;
  round: number;
  scheduled_at: string | null;
  mode: string | null;
  state: "assigned" | "completed" | "cancelled";
  recommendation: string | null;
  rating: number | null;
  interviewer_id: string;
  candidate: { id: string; name: string; designation: string | null; status: string | null; candidate_code: string } | null;
};

export function InterviewTable({
  rows,
  nameOf,
  showInterviewer,
}: {
  rows: InterviewListRow[];
  nameOf?: Map<string, string>;
  showInterviewer: boolean;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <TH>When</TH>
          <TH>Candidate</TH>
          <TH>Designation</TH>
          <TH>Round</TH>
          {showInterviewer && <TH>Interviewer</TH>}
          <TH>Result</TH>
          <TH>Candidate status</TH>
          <TH> </TH>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <TRow key={r.id}>
            <TD className="whitespace-nowrap text-ink-2">
              {fmtDateTime(r.scheduled_at)}
              {r.mode && <p className="text-xs text-ink-3">{r.mode}</p>}
            </TD>
            <TD>
              {r.candidate ? (
                <Link href={`/hr/candidates/${r.candidate.id}`} className="font-medium text-accent hover:underline">
                  {r.candidate.name}
                </Link>
              ) : (
                "—"
              )}
            </TD>
            <TD className="text-ink-2">{r.candidate?.designation ?? "—"}</TD>
            <TD className="text-ink-2">{r.round}</TD>
            {showInterviewer && <TD className="text-ink-2">{nameOf?.get(r.interviewer_id) ?? "—"}</TD>}
            <TD>
              {r.state === "completed" && r.recommendation ? (
                <Badge tone={recommendationTone(r.recommendation)}>
                  {RECOMMENDATION_LABEL[r.recommendation]} · {r.rating}/5
                </Badge>
              ) : r.state === "cancelled" ? (
                <Badge>Cancelled</Badge>
              ) : (
                <Badge tone="warn">Awaiting feedback</Badge>
              )}
            </TD>
            <TD>
              {r.candidate?.status ? <Badge tone={statusTone(r.candidate.status)}>{r.candidate.status}</Badge> : "—"}
            </TD>
            <TD className="whitespace-nowrap">
              <Link href={`/hr/evaluate/${r.id}`} className="text-xs font-medium text-accent hover:underline">
                {r.state === "completed" ? "View form →" : "Open form →"}
              </Link>
            </TD>
          </TRow>
        ))}
      </tbody>
    </Table>
  );
}
