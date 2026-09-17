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
  FeedbackForm,
  OpeningForm,
  RemoveInterviewerButton,
  ResumeLinkForm,
  StatusForm,
} from "../../HrForms";

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
      "id, candidate_code, entry_date, name, designation, phone, current_salary, expected_salary, experience_years, industry_experience, hr_remarks, job_change_reason, status, resume_url, opening_code, opening_id, excel_row",
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
  // Only people with Interviewer access can be sent candidates.
  const interviewers = people.filter((p) => p.canInterview).map(({ id, label }) => ({ id, label }));

  // Group interviews into panels (one round, one or more interviewers).
  const panels = new Map<string, Interview[]>();
  for (const iv of (ivs ?? []) as Interview[]) {
    panels.set(iv.panel_id, [...(panels.get(iv.panel_id) ?? []), iv]);
  }
  const panelList = [...panels.values()].sort((a, b) => a[0].round - b[0].round || a[0].created_at.localeCompare(b[0].created_at));
  const nextRound =
    Math.max(0, ...panelList.filter((p) => p.some((i) => i.state !== "cancelled")).map((p) => p[0].round)) + 1;

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

          <Card className="space-y-4">
            <CardLabel>Interviews</CardLabel>
            {panelList.length === 0 && <p className="text-sm text-ink-2">No interviews yet.</p>}
            <ul className="space-y-3">
              {panelList.map((panel) => {
                const head = panel[0];
                const live = panel.filter((i) => i.state !== "cancelled");
                const done = live.filter((i) => i.state === "completed").length;
                const allCancelled = live.length === 0;
                const onPanel = new Set(live.map((i) => i.interviewer_id));
                return (
                  <li key={head.panel_id} className="space-y-2 rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink">
                        Round {head.round}
                        <span className="ml-2 text-xs font-normal text-ink-2">
                          {fmtDateTime(head.scheduled_at)}
                          {head.mode && ` · ${head.mode}`}
                        </span>
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
                            {mine && iv.state === "assigned" && (
                              <div className="mt-2 border-t border-line pt-3">
                                <FeedbackForm id={iv.id} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {isHr && !allCancelled && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <AddPanelInterviewerForm
                          panelId={head.panel_id}
                          people={interviewers.filter((p) => !onPanel.has(p.id))}
                        />
                        {live.some((i) => i.state === "assigned") && (
                          <CancelPanelButton panelId={head.panel_id} candidateId={c.id} />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          {isHr && (
            <Card className="space-y-4">
              <CardLabel>Send for interview</CardLabel>
              {interviewers.length === 0 ? (
                <p className="text-sm text-ink-2">
                  Nobody has Interviewer access yet. Switch it on for people in the Control Panel.
                </p>
              ) : (
                <AssignPanelForm candidateId={c.id} nextRound={nextRound} people={interviewers} />
              )}
            </Card>
          )}

          {(history ?? []).length > 0 && (
            <Card className="space-y-3">
              <CardLabel>Status history</CardLabel>
              <ul className="space-y-1.5 text-sm">
                {(history ?? []).map((h, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink">
                      {h.from_status ?? "—"} → <b>{h.to_status ?? "—"}</b>
                    </span>
                    <span className="text-xs text-ink-3">
                      {fmtDateTime(h.changed_at)} ·{" "}
                      {h.source === "excel" ? "in Excel" : (nameOf.get(h.changed_by ?? "") ?? "app")}
                    </span>
                  </li>
                ))}
              </ul>
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
