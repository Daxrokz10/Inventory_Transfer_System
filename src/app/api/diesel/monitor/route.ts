import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runMonitorChecks, type InsightFact } from "@/lib/diesel/monitorChecks";
import { chatComplete } from "@/lib/llm/client";

/* Once-daily diesel review. Triggered by Vercel Cron (see vercel.json).

   Order of operations matters and is the point of the whole design:

     1. Run the rule checks. No LLM involved — see monitorChecks.ts.
     2. Write the findings, each carrying its rule-written message.
     3. ONLY THEN, if the local model happens to be reachable, ask it to
        rewrite those messages more readably and update the rows.

   So a run that happens while the host PC is asleep still produces a
   complete, useful set of insights. The model is polish, never the source.

   This route never returns a non-2xx for "the model was offline" — a quiet
   PC-off day is expected, not an incident, and a 500 here would show up as a
   failed cron in the Vercel dashboard every night. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Vercel Cron sends this header; nothing else should reach this route.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const admin = createAdminClient();

  let facts: InsightFact[];
  try {
    facts = await runMonitorChecks(admin, today);
  } catch (err) {
    // A genuine failure of the checks themselves IS worth a non-2xx — unlike
    // the model being offline, this means the review didn't happen.
    console.error("Monitor checks failed outright", err);
    return NextResponse.json(
      { ok: false, stage: "checks", error: String(err) },
      { status: 500 },
    );
  }

  if (facts.length === 0) {
    return NextResponse.json({ ok: true, run_date: today, written: 0, phrased: 0 });
  }

  // Upsert on (run_date, project_id, category) — the migration's unique
  // constraint — so a re-run today corrects rather than duplicates.
  const { data: written, error } = await admin
    .from("diesel_ai_insights")
    .upsert(
      facts.map((f) => ({
        run_date: today,
        project_id: f.project_id,
        category: f.category,
        severity: f.severity,
        message: f.message,
        // The rule's own wording is kept alongside the facts, because the
        // phrasing pass below overwrites `message` in place — this is what
        // makes a rewritten insight auditable back to what the rule said.
        raw_facts: { ...f.raw_facts, rule_message: f.message },
      })),
      { onConflict: "run_date,project_id,category" },
    )
    .select("id, message");
  if (error) {
    console.error("Monitor insert failed", error);
    return NextResponse.json(
      { ok: false, stage: "write", error: error.message },
      { status: 500 },
    );
  }

  const rows = written ?? [];
  const phrased = await phraseInsights(admin, rows);

  return NextResponse.json({
    ok: true,
    run_date: today,
    written: rows.length,
    phrased,
  });
}

const PHRASE_SYSTEM = `You rewrite internal diesel-monitoring notes so a site administrator can read them quickly.

Rules:
- Keep every number, site name and machine name exactly as given. Change no figure.
- Do not add findings, causes, or blame. Do not mention theft or fraud.
- One or two sentences. Plain, direct, no preamble and no bullet points.
- Reply with the rewritten note only, nothing else.`;

/** Best-effort readability pass. Every failure path here is a no-op that
    leaves the rule-written message in place, because that message is already
    correct and complete on its own. */
async function phraseInsights(
  admin: ReturnType<typeof createAdminClient>,
  rows: { id: string; message: string }[],
): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const result = await chatComplete(
      [
        { role: "system", content: PHRASE_SYSTEM },
        { role: "user", content: row.message },
      ],
      { maxTokens: 200, temperature: 0.1, timeoutMs: 15_000 },
    );
    // The first failure is almost always "PC is asleep", and every subsequent
    // call would wait out the same timeout — 20 findings × 15 s would run the
    // function past its limit. Stop at the first sign the model isn't there.
    if (!result.ok) break;

    // A model that ignores the brief and returns an essay, or drops the
    // detail entirely, is worse than the rule text — keep the original.
    const text = result.text.trim();
    if (text.length < 20 || text.length > row.message.length * 1.5) continue;

    const { error } = await admin
      .from("diesel_ai_insights")
      .update({ message: text })
      .eq("id", row.id);
    if (!error) count++;
  }
  return count;
}
