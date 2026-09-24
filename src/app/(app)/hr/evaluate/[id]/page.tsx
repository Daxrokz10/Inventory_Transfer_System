import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardLabel } from "@/components/ui/Card";
import { getHrContext } from "@/lib/hr/auth";
import { parseScores } from "@/lib/hr/evaluation";
import { fmtDateTime } from "@/lib/hr/format";
import { listPeople } from "@/lib/hr/people";
import { ResumeFrame, ResumeSkeleton } from "../../ResumePanel";
import { AssignPanelForm } from "../../HrForms";
import { EvaluationForm } from "./EvaluationForm";

/* The interview room: the evaluation form on the left, the candidate's resume
   beside it, so the interviewer can read and score at the same time. */

export default async function EvaluatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, access } = await getHrContext("interviewer");

  const { data: iv } = await supabase
    .from("hr_interviews")
    .select("id, candidate_id, interviewer_id, round, scheduled_at, mode, hr_note, state, feedback, rating, recommendation, scores, completed_at")
    .eq("id", id)
    .maybeSingle();
  if (!iv) notFound();

  const mine = iv.interviewer_id === user.id;
  // Anyone interviewing this candidate may read the other evaluations for them
  // — the earlier round, and the rest of their own panel. Only the interviewer
  // whose form it is can fill it in.
  const onThisCandidate = mine
    ? true
    : Boolean(
        (
          await supabase
            .from("hr_interviews")
            .select("id")
            .eq("candidate_id", iv.candidate_id)
            .eq("interviewer_id", user.id)
            .neq("state", "cancelled")
            .limit(1)
        ).data?.length,
      );
  if (!mine && !access.hrStaff && !onThisCandidate) notFound();

  const [{ data: c }, people] = await Promise.all([
    supabase
      .from("hr_candidates")
      .select("id, candidate_code, name, designation, phone, experience_years, industry_experience, current_salary, expected_salary, job_change_reason, hr_remarks, resume_url, opening_code")
      .eq("id", iv.candidate_id)
      .maybeSingle(),
    listPeople(),
  ]);
  if (!c) notFound();
  const interviewer = people.find((p) => p.id === iv.interviewer_id)?.name ?? "Unknown";
  const readOnly = !mine || iv.state === "completed" || iv.state === "cancelled";

  // Once this evaluation is in, the interviewer can hand the candidate to
  // whoever should take the next round, without going via HR.
  const { data: allRounds } = await supabase
    .from("hr_interviews")
    .select("round, state")
    .eq("candidate_id", iv.candidate_id);
  const nextRound = Math.max(0, ...(allRounds ?? []).filter((r) => r.state !== "cancelled").map((r) => r.round)) + 1;
  const canPassOn = mine && iv.state === "completed";
  const interviewers = people.filter((p) => p.canInterview).map(({ id, label }) => ({ id, label }));

  const facts: [string, string | null][] = [
    ["Designation", c.designation],
    ["Experience", c.experience_years],
    ["Industry experience", c.industry_experience],
    ["Current salary", c.current_salary],
    ["Expected salary", c.expected_salary],
    ["Phone", c.phone],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={mine ? "/hr/my-interviews" : `/hr/candidates/${iv.candidate_id}`} className="text-sm text-ink-2 hover:underline">
            ← {mine ? "My interviews" : "Candidate"}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {c.name}
            <span className="ml-2 text-base font-normal text-ink-2">{c.designation ?? ""}</span>
          </h1>
          <p className="text-xs text-ink-3">
            Technical Interview Evaluation · Round {iv.round} · {fmtDateTime(iv.scheduled_at)}
            {iv.mode ? ` · ${iv.mode}` : ""} · {c.candidate_code}
            {c.opening_code ? ` · ${c.opening_code}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {iv.state === "completed" && <Badge tone="good">Submitted {fmtDateTime(iv.completed_at)}</Badge>}
          {iv.state === "cancelled" && <Badge tone="danger">Cancelled</Badge>}
          {!mine && <Badge>{iv.state === "completed" ? "Filled by" : "Assigned to"} {interviewer}</Badge>}
        </div>
      </div>

      {iv.hr_note && (
        <p className="rounded-md bg-accent-soft px-4 py-2 text-sm text-ink">
          <span className="font-medium">Note from HR:</span> {iv.hr_note}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card className="space-y-3">
            <CardLabel>Candidate</CardLabel>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-ink-3">{k}</dt>
                  <dd className="text-ink">{v ?? "—"}</dd>
                </div>
              ))}
            </dl>
            {c.job_change_reason && (
              <p className="text-sm">
                <span className="text-xs text-ink-3">Reason for job change</span>
                <br />
                {c.job_change_reason}
              </p>
            )}
            {c.hr_remarks && (
              <p className="text-sm">
                <span className="text-xs text-ink-3">HR remarks</span>
                <br />
                {c.hr_remarks}
              </p>
            )}
          </Card>

          <Card>
            <EvaluationForm
              interviewId={iv.id}
              initialScores={parseScores(iv.scores)}
              initialFeedback={iv.feedback}
              initialRating={iv.rating}
              initialRecommendation={iv.recommendation}
              readOnly={readOnly}
            />
            {readOnly && !mine && (
              <p className="mt-3 text-xs text-ink-3">
                Read-only: {interviewer}&apos;s form for this candidate
                {iv.state === "completed" ? "." : " — not submitted yet."}
              </p>
            )}
            {readOnly && mine && iv.state === "completed" && (
              <p className="mt-3 text-xs text-ink-3">Submitted. Ask HR if something needs changing.</p>
            )}
          </Card>

          {canPassOn && (
            <Card className="space-y-3">
              <CardLabel>Send to round {nextRound}</CardLabel>
              <p className="text-sm text-ink-2">
                Taking {c.name} forward? Choose who should interview them next. HR is told, and can change it.
                {iv.recommendation === "reject" && " You recommended rejecting — leave this alone if that stands."}
              </p>
              {interviewers.length === 0 ? (
                <p className="text-sm text-ink-2">Nobody else has Interviewer access yet.</p>
              ) : (
                <AssignPanelForm candidateId={iv.candidate_id} nextRound={nextRound} existingRounds={[]} people={interviewers} />
              )}
            </Card>
          )}
        </div>

        <Card className="space-y-2 xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)]">
          <div className="flex items-center justify-between">
            <CardLabel>Resume</CardLabel>
            {c.resume_url && (
              <a href={c.resume_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent hover:underline">
                Open in OneDrive ↗
              </a>
            )}
          </div>
          <Suspense fallback={<ResumeSkeleton className="h-full" />}>
            <ResumeFrame url={c.resume_url} name={c.name} className="h-full min-h-[60vh]" />
          </Suspense>
        </Card>
      </div>
    </div>
  );
}
