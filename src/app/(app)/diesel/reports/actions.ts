"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { chatComplete } from "@/lib/llm/client";
import {
  gatherDieselSnapshot,
  DIESEL_SYSTEM_PROMPT,
} from "@/lib/diesel/llmContext";

/* Written summary of the diesel report for a date range, produced by the
   locally-hosted model from the same figures the table below it shows.

   Never called during render — the model lives on a PC at home behind a
   tunnel and may be asleep, so this only ever runs on an explicit click and
   returns an error string instead of throwing. */

export type NarrativeState =
  | { status: "idle" }
  | { status: "done"; text: string; start: string; end: string }
  | { status: "error"; error: string };

const INSTRUCTION = `Write a short briefing on this diesel period for a company director who will not open the table.

Structure it as:
- One opening line: total fuel, total cost, how many sites and machines.
- "Where the fuel went": the two or three sites that dominate consumption, with their numbers.
- "Worth a look": anything genuinely notable — a negative or near-zero barrel balance, a machine whose average looks out of line with others of its kind, a cluster of open anomaly flags. If nothing stands out, say so in one line rather than manufacturing a concern.
- "Suggested checks": at most three concrete things a site supervisor could verify.

Plain prose and short bullet points, no headings beyond the ones above, no preamble, under 300 words. Quote figures exactly as given.`;

export async function generateNarrative(
  _prev: NarrativeState,
  formData: FormData,
): Promise<NarrativeState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Re-checked here, not inherited from the page — a server action is its
  // own entry point.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? null;
  if (role !== "admin" && role !== "superadmin") redirect("/diesel");

  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const start = String(formData.get("start") ?? "");
  const end = String(formData.get("end") ?? "");
  if (!isDate(start) || !isDate(end)) {
    return { status: "error", error: "Pick a valid date range first." };
  }
  const site = String(formData.get("site") ?? "").trim() || null;

  const snapshot = await gatherDieselSnapshot(supabase, {
    start,
    end,
    siteFilter: site,
  });
  if (snapshot.isEmpty) {
    return {
      status: "error",
      error: "No daily reports in this range yet — nothing to summarise.",
    };
  }

  const result = await chatComplete(
    [
      { role: "system", content: DIESEL_SYSTEM_PROMPT },
      { role: "user", content: `${snapshot.markdown}\n\n${INSTRUCTION}` },
    ],
    // The brief above asks for under 300 words; this is headroom on that, not
    // an invitation to write more.
    { maxTokens: 700 },
  );

  if (!result.ok) return { status: "error", error: result.error };
  return { status: "done", text: result.text, start, end };
}
