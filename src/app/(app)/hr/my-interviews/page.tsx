import { Card, CardLabel } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getHrContext } from "@/lib/hr/auth";
import { InterviewTable, type InterviewListRow } from "../InterviewTable";

export default async function MyInterviewsPage() {
  const { supabase, user } = await getHrContext("interviewer");

  const { data } = await supabase
    .from("hr_interviews")
    .select("id, round, scheduled_at, mode, state, recommendation, rating, interviewer_id, candidate:candidate_id(id, name, designation, status, candidate_code)")
    .eq("interviewer_id", user.id)
    .neq("state", "cancelled")
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(300);
  const rows = (data ?? []) as unknown as InterviewListRow[];
  const pending = rows.filter((r) => r.state === "assigned");
  const done = rows.filter((r) => r.state === "completed").reverse();

  return (
    <div className="space-y-5">
      <PageHeader
        title="My interviews"
        subtitle="Candidates HR has sent to you. Open one to see their details and resume, then submit your feedback."
      />

      <section className="space-y-2">
        <CardLabel>To do · {pending.length}</CardLabel>
        <Card className="overflow-x-auto p-0">
          {pending.length === 0 ? (
            <p className="p-6 text-sm text-ink-2">Nothing waiting for you.</p>
          ) : (
            <InterviewTable rows={pending} showInterviewer={false} />
          )}
        </Card>
      </section>

      {done.length > 0 && (
        <section className="space-y-2">
          <CardLabel>Feedback given · {done.length}</CardLabel>
          <Card className="overflow-x-auto p-0">
            <InterviewTable rows={done} showInterviewer={false} />
          </Card>
        </section>
      )}
    </div>
  );
}
