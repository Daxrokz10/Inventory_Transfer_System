"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { RATING_LABELS, RATING_SCALE, SKILLS, averageScore, type Scores } from "@/lib/hr/evaluation";
import { saveEvaluationDraft, submitFeedback } from "../../actions";

/* The paper form, on screen. Answers are saved quietly a couple of seconds
   after each change, so a half-finished interview is never lost, and the
   interviewer submits at the end. */

const AUTOSAVE_MS = 2000;

export function EvaluationForm({
  interviewId,
  initialScores,
  initialFeedback,
  initialRating,
  initialRecommendation,
  readOnly,
}: {
  interviewId: string;
  initialScores: Scores;
  initialFeedback: string | null;
  initialRating: number | null;
  initialRecommendation: string | null;
  readOnly: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [scores, setScores] = useState<Scores>(initialScores);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, action, pending] = useActionState(submitFeedback, null);
  const average = averageScore(scores);

  const queueSave = () => {
    if (readOnly) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const form = formRef.current;
      if (!form) return;
      setSaved("saving");
      const result = await saveEvaluationDraft(null, new FormData(form));
      setSaved(result ? "error" : "saved");
    }, AUTOSAVE_MS);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <form ref={formRef} action={action} onChange={queueSave} className="space-y-6">
      <input type="hidden" name="id" value={interviewId} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-3">Technical skills assessment</h2>
          <p className="text-xs text-ink-3">{RATING_SCALE}</p>
        </div>

        <ol className="divide-y divide-line rounded-lg border border-line">
          {SKILLS.map((skill, i) => (
            <li key={skill.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex-1 text-sm text-ink">
                <span className="mr-2 text-ink-3">{i + 1}.</span>
                {skill.label}
              </span>
              <span className="flex gap-1" role="radiogroup" aria-label={skill.label}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = scores[skill.id] === n;
                  return (
                    <label key={n} title={RATING_LABELS[n]}>
                      <input
                        type="radio"
                        name={`score_${skill.id}`}
                        value={n}
                        defaultChecked={active}
                        disabled={readOnly}
                        onChange={() => setScores((s) => ({ ...s, [skill.id]: n }))}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-sm font-medium transition-colors",
                          active
                            ? "border-accent bg-accent text-white"
                            : "border-line-strong text-ink-2 hover:border-accent hover:text-accent",
                          readOnly && "cursor-default opacity-70",
                        )}
                      >
                        {n}
                      </span>
                    </label>
                  );
                })}
              </span>
            </li>
          ))}
        </ol>
        {average !== null && (
          <p className="text-xs text-ink-2">
            Average of the skills scored: <span className="font-semibold text-ink">{average}</span> / 5
          </p>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Overall rating *">
          <Select name="rating" required defaultValue={initialRating ? String(initialRating) : ""} disabled={readOnly}>
            <option value="" disabled>
              Choose
            </option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} — {RATING_LABELS[n]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Recommendation *" hint="This moves the candidate's status once everyone on the round has submitted. HR can still change it.">
          <Select name="recommendation" required defaultValue={initialRecommendation ?? ""} disabled={readOnly}>
            <option value="" disabled>
              Choose
            </option>
            <option value="hire">Hire</option>
            <option value="next_round">Next round</option>
            <option value="hold">On hold — leave it to HR</option>
            <option value="reject">Reject</option>
          </Select>
        </Field>
      </div>

      <Field label="Remarks *">
        <Textarea
          name="feedback"
          rows={5}
          required
          defaultValue={initialFeedback ?? ""}
          disabled={readOnly}
          placeholder="Strengths, gaps, anything HR should know…"
        />
      </Field>

      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {!readOnly && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-surface py-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Submitting…" : "Submit evaluation"}
          </Button>
          <span className="text-xs text-ink-3">
            {saved === "saving" && "Saving…"}
            {saved === "saved" && "Draft saved — you can finish later"}
            {saved === "error" && <span className="text-danger">Draft not saved — check your connection</span>}
            {saved === "idle" && "Answers are saved as you go"}
          </span>
        </div>
      )}
    </form>
  );
}
