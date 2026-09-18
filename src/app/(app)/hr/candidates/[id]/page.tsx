import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card, CardLabel } from "@/components/ui/Card";
import { getHrContext } from "@/lib/hr/auth";
import { getOpenOpenings, getStages } from "@/lib/hr/data";
import { RECOMMENDATION_LABEL, fmtDateTime, recommendationTone, statusTone } from "@/lib/hr/format";
import { listPeople } from "@/lib/hr/people";
import { resumeEmbedUrl } from "@/lib/hr/resume";
import { FIELD_LABELS } from "@/lib/hr/sheet";
import {
  AddPanelInterviewerForm,
  AssignPanelForm,
  CancelPanelButton,
  EditCandidateForm,
  HrDecisionForm,
  OpeningForm,
  RemoveInterviewerButton,
  ResumeLinkForm,
  StatusForm,
} from "../../HrForms";
import { Timeline, buildTimeline } from "../../Timeline";

type Interview = {
  id: string;
  panel_id: string;
  interviewer_id: string;
  round: number;
  scheduled_at: string | null;
  mode: string | null;
  hr_note: string | null;
  state: "assigned" | "completed" | "cancelled";
  feedback: string | null;
  rating: number | null;
  recommendation: string | null;
  completed_at: string | null;
  created_at: string;
};

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, access } = await getHrContext("interviewer");
  const isHr = access.hrStaff;

  // RLS: HR sees every candidate; interviewers only candidates assigned to them.
  const { data: c } = await supabase
    .from("hr_candidates")
    .select(
      "id, candidate_code, entry_date, created_at, name, designation, phone, current_salary, expected_salary, experience_years, industry_experience, hr_remarks, job_change_reason, status, resume_url, opening_code, opening_id, excel_row, offered_salary, date_of_joining, hr_comments",
    )
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const [{ data: ivs }, { data: history }, people, embed, stages, openings] = await Promise.all([
    supabase
      .from("hr_interviews")
      .select("id, panel_id, interviewer_id, round, scheduled_at, mode, hr_note, state, feedback, rating, recommendation, completed_at, created_at")
      .eq("candidate_id", id)
      .order("created_at"),
    supabase
      .from("hr_status_history")
      .select("from_status, to_status, source, changed_by, changed_at")
      .eq("candidate_id", id)
      .order("changed_at", { ascending: false })
      .limit(30),
    listPeople(),
    resumeEmbedUrl(c.resume_url),
    isHr ? getStages() : Promise.resolve([]),
    isHr ? getOpenOpenings() : Promise.resolve([]),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  // The opening this candidate was tagged to, for the start of the timeline.
  const { data: opening } = c.opening_id
    ? await supabase
        .from("hr_openings")
        .select("id, code, designation, headcount, created_at, raised_by")
        .eq("id", c.opening_id)
        .maybeSingle()
    : { data: null };
  // Only people with Interviewer access can be sent candidates.
  const interviewers = people.filter((p) => p.canInterview).map(({ id, label }) => ({ id, label }));

  // Group interviews into panels (one round, one or more interviewers).
  const panels = new Map<string, Interview[]>();
  for (const iv of (ivs ?? []) as Interview[]) {
    panels.set(iv.panel_id, [...(panels.get(iv.panel_id) ?? []), iv]);
  }
  const panelList = [...panels.values()].sort((a, b) => a[0].round - b[0].round || a[0].created_at.localeCompare(b[0].created_at));
  const liveRounds = [...new Set(panelList.filter((p) => p.some((i) => i.state !== "cancelled")).map((p) => p[0].round))].sort(
    (a, b) => a - b,
  );
  const nextRound = (liveRounds.at(-1) ?? 0) + 1;
  // An interviewer who took one of this candidate's rounds may set up the next.
  const onThisCandidate = panelList.some((p) => p.some((i) => i.interviewer_id === user.id && i.state !== "cancelled"));
  // A round everyone has already given feedback on is finished: interviewers
  // can only be added to a round still waiting on someone.
  const openRounds = liveRounds.filter((r) =>
    panelList.some((p) => p[0].round === r && p.some((i) => i.state === "assigned")),
  );
  // Panels grouped by round number, so "Round 2" reads as one step even when
  // its interviewers were added at different times.
  const rounds = [...new Set(panelList.map((p) => p[0].round))]
    .sort((a, b) => a - b)
    .map((round) => ({ round, panels: panelList.filter((p) => p[0].round === round) }));

  const timeline = buildTimeline({
    candidate: { entry_date: c.entry_date, created_at: c.created_at, status: c.status, name: c.name },
    opening: opening
      ? { ...opening, raiser: opening.raised_by ? (nameOf.get(opening.raised_by) ?? null) : null }
      : null,
    history: [...(history ?? [])].reverse(),
    panels: panelList.map((panel) => ({
      panel_id: panel[0].panel_id,
      round: panel[0].round,
      scheduled_at: panel[0].scheduled_at,
      mode: panel[0].mode,
      created_at: panel[0].created_at,
      members: panel.map((iv) => ({
        name: nameOf.get(iv.interviewer_id) ?? "Unknown",
        state: iv.state,
        recommendation: iv.recommendation,
        rating: iv.rating,
        completed_at: iv.completed_at,
      })),
    })),
    nameOf,
  });

  const details: [string, string | null][] = [
    [FIELD_LABELS.entry_date, c.entry_date],
    [FIELD_LABELS.designation, c.designation],
    [FIELD_LABELS.phone, c.phone],
    [FIELD_LABELS.experience_years, c.experience_years],
    [FIELD_LABELS.industry_experience, c.industry_experience],
    [FIELD_LABELS.current_salary, c.current_salary],
    [FIELD_LABELS.expected_salary, c.expected_salary],
  ];

  return (
    <div className="space-y-5">
      <Link href={isHr ? "/hr" : "/hr/my-interviews"} className="text-sm text-ink-2 hover:underline">
        ← {isHr ? "Candidates" : "My interviews"}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-ink-3">
            {c.candidate_code}
            {isHr && (c.excel_row ? ` · Excel row ${c.excel_row}` : " · not in Excel yet")}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{c.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {c.designation ?? "No designation"}
            {c.status && <Badge tone={statusTone(c.status)}>{c.status}</Badge>}
            {isHr && (
              <Link href={`/hr/status?candidate=${c.id}`} className="text-xs font-medium text-accent hover:underline">
                Show status
              </Link>
            )}
          </p>
        </div>
        {isHr && <StatusForm key={c.status ?? ""} id={c.id} status={c.status} stages={stages.map((s) => s.name)} />}
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <div className="space-y-5 xl:col-span-2">
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <CardLabel>Details</CardLabel>
              {isHr && <EditCandidateForm c={c} />}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-ink-3">{label}</dt>
                  <dd className="text-ink">{value ?? "—"}</dd>
                </div>
              ))}
              <div className="col-span-2">
                <dt className="text-xs text-ink-3">Opening</dt>
                <dd className="text-ink">
                  {isHr ? (
                    <OpeningForm key={c.opening_code ?? ""} id={c.id} code={c.opening_code} openings={openings} />
                  ) : (
                    (c.opening_code ?? "—")
                  )}
                </dd>
              </div>
            </dl>
            <div className="text-sm">
              <p className="text-xs text-ink-3">{FIELD_LABELS.job_change_reason}</p>
              <p className="whitespace-pre-wrap text-ink">{c.job_change_reason ?? "—"}</p>
            </div>
            <div className="text-sm">
              <p className="text-xs text-ink-3">{FIELD_LABELS.hr_remarks}</p>
              <p className="whitespace-pre-wrap text-ink">{c.hr_remarks ?? "—"}</p>
            </div>
          </Card>

          {isHr && (
            <Card className="space-y-3">
              <CardLabel>HR decision</CardLabel>
              <HrDecisionForm
                id={c.id}
                offeredSalary={c.offered_salary}
                dateOfJoining={c.date_of_joining}
                comments={c.hr_comments}
              />
            </Card>
          )}

          <Card className="space-y-4">
            <CardLabel>Progress</CardLabel>
            <Timeline events={timeline} />
          </Card>

          <Card className="space-y-4">
            <CardLabel>Interviews</CardLabel>
            {panelList.length === 0 && <p className="text-sm text-ink-2">No interviews yet.</p>}
            <ul className="space-y-5">
              {rounds.map(({ round, panels: roundPanels }) => (
                <li key={round} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">Round {round}</p>
                  <ul className="space-y-3">
              {roundPanels.map((panel) => {
                const head = panel[0];
                const live = panel.filter((i) => i.state !== "cancelled");
                const done = live.filter((i) => i.state === "completed").length;
                const allCancelled = live.length === 0;
                const onPanel = new Set(live.map((i) => i.interviewer_id));
                return (
                  <li key={head.panel_id} className="space-y-2 rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-ink-2">
                        {fmtDateTime(head.scheduled_at)}
                        {head.mode && ` · ${head.mode}`}
                      </p>
                      {allCancelled ? (
                        <Badge>Cancelled</Badge>
                      ) : (
                        <Badge tone={done === live.length ? "good" : "warn"}>
                          {done} of {live.length} submitted
                        </Badge>
                      )}
                    </div>
                    {head.hr_note && <p className="text-xs text-ink-2">HR note: {head.hr_note}</p>}

                    <ul className="space-y-2">
                      {panel.map((iv) => {
                        const mine = iv.interviewer_id === user.id;
                        return (
                          <li key={iv.id} className="rounded-md bg-inset p-2 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-ink">
                                {nameOf.get(iv.interviewer_id) ?? "Unknown"}
                                {mine && <span className="font-normal text-ink-3"> (you)</span>}
                              </span>
                              <span className="flex items-center gap-2">
                                {iv.state === "completed" && iv.recommendation ? (
                                  <Badge tone={recommendationTone(iv.recommendation)}>
                                    {RECOMMENDATION_LABEL[iv.recommendation]} · {iv.rating}/5
                                  </Badge>
                                ) : iv.state === "cancelled" ? (
                                  <Badge>Cancelled</Badge>
                                ) : (
                                  <Badge tone="warn">Awaiting feedback</Badge>
                                )}
                                {isHr && iv.state === "assigned" && <RemoveInterviewerButton id={iv.id} />}
                              </span>
                            </div>
                            {iv.state === "completed" && (
                              <p className="mt-1 whitespace-pre-wrap text-ink">
                                {iv.feedback}
                                <span className="block text-xs text-ink-3">{fmtDateTime(iv.completed_at)}</span>
                              </p>
                            )}
                            {(mine || iv.state === "completed") && (
                              <Link
                                href={`/hr/evaluate/${iv.id}`}
                                className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
                              >
                                {mine && iv.state === "assigned" ? "Open evaluation form →" : "View evaluation form →"}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {isHr && !allCancelled && live.some((i) => i.state === "assigned") && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <AddPanelInterviewerForm
                          panelId={head.panel_id}
                          people={interviewers.filter((p) => !onPanel.has(p.id))}
                        />
                        <CancelPanelButton panelId={head.panel_id} candidateId={c.id} />
                      </div>
                    )}
                  </li>
                );
              })}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>

          {(isHr || onThisCandidate) && (
            <Card className="space-y-4">
              <CardLabel>{isHr ? "Send for interview" : "Send to the next round"}</CardLabel>
              {!isHr && (
                <p className="text-sm text-ink-2">
                  Pass this candidate on to whoever should take round {nextRound}. HR is told, and can change it.
                </p>
              )}
              {interviewers.length === 0 ? (
                <p className="text-sm text-ink-2">
                  Nobody has Interviewer access yet. Switch it on for people in the Control Panel.
                </p>
              ) : (
                <AssignPanelForm
                  candidateId={c.id}
                  nextRound={nextRound}
                  existingRounds={isHr ? openRounds : []}
                  people={interviewers}
                />
              )}
            </Card>
          )}

        </div>

        <Card className="space-y-3 xl:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardLabel>Resume</CardLabel>
            <div className="flex items-center gap-2">
              {c.resume_url && (
                <a href={c.resume_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent hover:underline">
                  Open in OneDrive ↗
                </a>
              )}
              {isHr && c.resume_url && <ResumeLinkForm id={c.id} url={c.resume_url} />}
            </div>
          </div>
          {embed.note && <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">{embed.note}</p>}
          {embed.src ? (
            <iframe
              src={embed.src}
              title={`Resume — ${c.name}`}
              className="h-[80vh] w-full rounded-md border border-line bg-white"
            />
          ) : (
            <div className="rounded-md border border-dashed border-line-strong p-6 text-sm text-ink-2">
              {c.resume_url ? (embed.error ?? "This link can't be previewed here. Use “Open in OneDrive”.") : "No resume link yet."}
            </div>
          )}
          {isHr && !c.resume_url && <ResumeLinkForm id={c.id} url={null} />}
        </Card>
      </div>
    </div>
  );
}
