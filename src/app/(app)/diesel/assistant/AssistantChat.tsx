"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import {
  askDieselAssistant,
  type AssistantState,
} from "./actions";

/* Chat surface for the diesel assistant.

   The transcript lives in this component's action state and nowhere else —
   no table, no localStorage. Reloading the page starts a fresh conversation,
   which is the right default for something that reads live data: an old
   transcript's numbers would be stale.

   The date range and site travel with every question, since the snapshot the
   model answers from is rebuilt per turn. */

const EXAMPLES = [
  "Which sites used the most diesel this period, and how much?",
  "Any site whose barrel balance has gone negative?",
  "Which machines look out of line with others of the same type?",
  "Summarise the open anomaly flags by what's actually worth checking.",
];

export function AssistantChat({
  sites,
  defaultStart,
  defaultEnd,
  today,
}: {
  sites: { id: string; label: string }[];
  defaultStart: string;
  defaultEnd: string;
  today: string;
}) {
  const [state, formAction, pending] = useActionState<AssistantState, FormData>(
    askDieselAssistant,
    { turns: [], error: null },
  );
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [site, setSite] = useState("");
  const [question, setQuestion] = useState("");

  const formRef = useRef<HTMLFormElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Clear the box only once a turn has actually landed — a failed question
  // stays put so it can be retried without retyping.
  const turnCount = state.turns.length;
  const lastLanded = useRef(turnCount);
  useEffect(() => {
    if (turnCount !== lastLanded.current) {
      lastLanded.current = turnCount;
      setQuestion("");
    }
  }, [turnCount]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnCount, pending]);

  const submitExample = (text: string) => {
    setQuestion(text);
    // Let the controlled value land before the form reads it.
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardLabel>What the assistant can see</CardLabel>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            From
            <Input
              type="date"
              value={start}
              max={end}
              onChange={(e) => setStart(e.target.value)}
              className="min-w-40"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            To
            <Input
              type="date"
              value={end}
              min={start}
              max={today}
              onChange={(e) => setEnd(e.target.value)}
              className="min-w-40"
            />
          </label>
          <Select
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className="min-w-48"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          Questions are answered only from the diesel data in this range —
          consumption per machine and site, barrel balances, and open anomaly
          flags. Anything outside it, the assistant will say it can&apos;t see.
        </p>
      </Card>

      <Card className="space-y-4">
        {state.turns.length === 0 && !pending && (
          <div>
            <p className="text-sm text-ink-2">
              Ask a question about the period above. For example:
            </p>
            <ul className="mt-2 space-y-1.5">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    onClick={() => submitExample(ex)}
                    className="text-left text-sm text-accent hover:underline"
                  >
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {state.turns.map((t, i) => (
          <div
            key={i}
            className={
              t.role === "user"
                ? "rounded-lg bg-surface-2 px-3 py-2"
                : "border-l-2 border-accent/40 pl-3"
            }
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              {t.role === "user" ? "You" : "Assistant"}
            </p>
            {/* Model output is rendered as plain text, never as markup. */}
            <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {t.content}
            </div>
          </div>
        ))}

        {pending && (
          <p className="text-sm text-ink-3">Thinking…</p>
        )}

        {state.error && (
          <p className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
            {state.error}
          </p>
        )}

        <div ref={bottomRef} />

        <form ref={formRef} action={formAction} className="space-y-2">
          <input type="hidden" name="start" value={start} />
          <input type="hidden" name="end" value={end} />
          <input type="hidden" name="site" value={site} />
          <Textarea
            name="question"
            rows={2}
            maxLength={500}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (question.trim() && !pending) formRef.current?.requestSubmit();
              }
            }}
            placeholder="Ask about fuel use, barrel balances or flagged machines…"
            className="w-full"
            disabled={pending}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={pending || !question.trim()}>
              {pending ? "Thinking…" : "Ask"}
            </Button>
            <span className="text-xs text-ink-3">
              Figures come from the report data — check anything you plan to act
              on against the Reports page.
            </span>
          </div>
        </form>
      </Card>
    </div>
  );
}
