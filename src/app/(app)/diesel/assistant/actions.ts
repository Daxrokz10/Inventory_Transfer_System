"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { chatComplete, type ChatMessage } from "@/lib/llm/client";
import {
  gatherDieselSnapshot,
  DIESEL_SYSTEM_PROMPT,
} from "@/lib/diesel/llmContext";

/* The ask-your-data assistant.

   Every answer is grounded in a freshly gathered snapshot of the selected
   date range — the model holds no state of its own and has no database
   access. Conversation history is passed back in from the client each turn,
   which keeps the transcript out of the database entirely.

   The snapshot is re-gathered on every turn rather than cached in the
   history. It costs a handful of read queries and means a question asked
   after someone files today's report sees that report. */

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export type AssistantState = {
  turns: Turn[];
  /** Set when the last question failed — shown once, and the failed question
      is not added to the transcript so it can simply be retried. */
  error: string | null;
};

/** How many prior turns travel back to the model. Local models have modest
    context and the snapshot is the bulk of it, so history is kept short. */
const HISTORY_TURNS = 6;
/** Long enough for a real question, short enough not to be a payload. */
const MAX_QUESTION_LEN = 500;

export async function askDieselAssistant(
  prev: AssistantState,
  formData: FormData,
): Promise<AssistantState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? null;
  if (role !== "admin" && role !== "superadmin") redirect("/diesel");

  const question = String(formData.get("question") ?? "")
    .trim()
    .slice(0, MAX_QUESTION_LEN);
  if (!question) return { ...prev, error: null };

  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const start = String(formData.get("start") ?? "");
  const end = String(formData.get("end") ?? "");
  if (!isDate(start) || !isDate(end)) {
    return { ...prev, error: "Pick a valid date range first." };
  }
  const site = String(formData.get("site") ?? "").trim() || null;

  const snapshot = await gatherDieselSnapshot(supabase, { start, end, siteFilter: site });

  // Rules and data go in as ONE system message, not two: Qwen's chat template
  // (and several others) permit only a single system message at position zero
  // and reject anything else outright. Keeping the data in the system role —
  // rather than as a user turn — still means it can't be mistaken for
  // something the admin typed.
  const dataBlock = snapshot.isEmpty
    ? `${snapshot.markdown}\n\nThere is no data for the selected period. Say so and suggest widening the date range.`
    : snapshot.markdown;

  const messages: ChatMessage[] = [
    { role: "system", content: `${DIESEL_SYSTEM_PROMPT}\n\n${dataBlock}` },
    ...prev.turns.slice(-HISTORY_TURNS).map(
      (t): ChatMessage => ({ role: t.role, content: t.content }),
    ),
    { role: "user", content: question },
  ];

  // Enough for a thorough answer to a real question, but not enough to spend
  // two minutes writing an essay a local model can't deliver in time.
  const result = await chatComplete(messages, { maxTokens: 700 });
  if (!result.ok) return { ...prev, error: result.error };

  return {
    turns: [
      ...prev.turns,
      { role: "user", content: question },
      { role: "assistant", content: result.text },
    ],
    error: null,
  };
}
