"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { hrStaffIds, notify } from "@/lib/notify";
import { getHrContext } from "@/lib/hr/auth";
import { forgetCachedToken, listWorksheets, resolveShareUrl } from "@/lib/hr/graph";
import { CANDIDATE_FIELDS, rowHash, sameCell, type CandidateField, type CandidateValues } from "@/lib/hr/sheet";
import { SKILLS, parseScores, type Scores } from "@/lib/hr/evaluation";
import { listPeople } from "@/lib/hr/people";
import { listStages, nextStatus, panelVerdict } from "@/lib/hr/stageFlow";
import {
  ExcelConflictError,
  appendCandidateToExcel,
  getConnection,
  nextCandidateCode,
  patchCandidateInExcel,
  syncFromExcel,
} from "@/lib/hr/sync";

type Supabase = Awaited<ReturnType<typeof getHrContext>>["supabase"];

const text = (fd: FormData, key: string) => {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function revalidateHr(id?: string) {
  revalidatePath("/hr", "layout");
  if (id) revalidatePath(`/hr/candidates/${id}`);
}

/** datetime-local has no zone; everyone using this is in India. */
function istToIso(local: string | null): string | null {
  if (!local) return null;
  const d = new Date(`${local}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isOneDriveLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith("sharepoint.com") || host.includes("onedrive") || host === "1drv.ms";
  } catch {
    return false;
  }
}

async function openingIdFor(supabase: Supabase, code: string | null | undefined): Promise<string | null> {
  if (!code) return null;
  const { data } = await supabase.from("hr_openings").select("id").eq("code", code.toUpperCase()).maybeSingle();
  return data?.id ?? null;
}

/* ---------------- candidates ---------------- */

export type QuickAddState = { error?: string; duplicate?: string; added?: string } | null;

/** Fast single-candidate entry: stays on the page, appends one Excel row. */
export async function quickAddCandidate(_prev: QuickAddState, fd: FormData): Promise<QuickAddState> {
  const { supabase, user } = await getHrContext("staff");

  const values = {} as Omit<CandidateValues, "candidate_code">;
  for (const f of CANDIDATE_FIELDS) if (f !== "candidate_code") values[f] = text(fd, f);
  if (!values.name) return { error: "Name is required." };
  if (values.resume_url && !isOneDriveLink(values.resume_url)) {
    return { error: "Resume must be a OneDrive / SharePoint link." };
  }
  if (values.opening_code) values.opening_code = values.opening_code.toUpperCase();
  // The Excel's Date column: today, in India.
  values.entry_date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata" }).format(new Date());

  // Same phone already on file? Ask once, then allow.
  const digits = (values.phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length >= 8 && fd.get("confirm_duplicate") !== "yes") {
    const { data: dupes } = await supabase
      .from("hr_candidates")
      .select("candidate_code, name, status")
      .ilike("phone", `%${digits}%`)
      .limit(3);
    if (dupes?.length) {
      return {
        duplicate: dupes.map((d) => `${d.name} (${d.candidate_code}${d.status ? `, ${d.status}` : ""})`).join("; "),
      };
    }
  }

  let excel: { row: number; code: string } | null = null;
  try {
    excel = await appendCandidateToExcel(values);
  } catch (e) {
    return { error: `Could not add the row to the Excel, nothing was saved: ${errMsg(e)}` };
  }
  const candidate_code = excel?.code ?? (await nextCandidateCode());
  const merged: CandidateValues = { ...values, candidate_code };

  const { data, error } = await supabase
    .from("hr_candidates")
    .insert({
      ...merged,
      opening_id: await openingIdFor(supabase, values.opening_code),
      excel_row: excel?.row ?? null,
      synced_at: excel ? new Date().toISOString() : null,
      sheet_hash: excel ? rowHash(merged) : null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (values.status) {
    await supabase.from("hr_status_history").insert({
      candidate_id: data.id,
      from_status: null,
      to_status: values.status,
      source: "app",
      changed_by: user.id,
    });
  }

  revalidateHr();
  return { added: `${values.name} added as ${candidate_code}.` };
}

/** Apply field changes to one candidate: only changed cells go to the Excel
    (after a conflict check), then the database. */
async function applyChange(
  supabase: Supabase,
  userId: string,
  id: string,
  patch: Partial<CandidateValues>,
): Promise<string | null> {
  const { data: current } = await supabase
    .from("hr_candidates")
    .select(`id, excel_row, synced_at, ${CANDIDATE_FIELDS.join(", ")}`)
    .eq("id", id)
    .maybeSingle();
  if (!current) return "Candidate not found.";
  const cur = current as unknown as CandidateValues & { id: string; excel_row: number | null; synced_at: string | null };

  const changes: Partial<CandidateValues> = {};
  const expected: Partial<CandidateValues> = {};
  for (const f of Object.keys(patch) as CandidateField[]) {
    if (f === "candidate_code") continue;
    if (!sameCell(cur[f], patch[f])) {
      changes[f] = patch[f] ?? null;
      expected[f] = cur[f];
    }
  }
  if (!Object.keys(changes).length) return null;

  // A candidate added while the Excel wasn't connected has no row yet; the
  // next sync appends it whole, so only the database changes now.
  const neverSynced = cur.synced_at === null && cur.excel_row === null;
  let row: number | null = null;
  try {
    if (!neverSynced) row = await patchCandidateInExcel(cur.candidate_code ?? "", changes, expected);
  } catch (e) {
    if (e instanceof ExcelConflictError) {
      // Pull the latest so the page shows what is in the Excel now.
      await syncFromExcel().catch(() => {});
      revalidateHr(id);
    }
    return e instanceof ExcelConflictError ? e.message : `Could not write to the Excel, nothing was saved: ${errMsg(e)}`;
  }

  const merged = { ...cur, ...changes } as CandidateValues;
  const update: Record<string, unknown> = { ...changes, updated_at: new Date().toISOString() };
  if ("opening_code" in changes) update.opening_id = await openingIdFor(supabase, changes.opening_code);
  if (row !== null) {
    update.excel_row = row;
    update.synced_at = new Date().toISOString();
    update.sheet_hash = rowHash(merged);
  }
  const { error } = await supabase.from("hr_candidates").update(update).eq("id", id);
  if (error) return error.message;

  if ("status" in changes) {
    await supabase.from("hr_status_history").insert({
      candidate_id: id,
      from_status: expected.status ?? null,
      to_status: changes.status ?? null,
      source: "app",
      changed_by: userId,
    });
  }

  revalidateHr(id);
  return null;
}

export async function updateCandidate(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user } = await getHrContext("staff");
  const id = text(fd, "id");
  if (!id) return "Missing candidate.";
  if (!text(fd, "name")) return "Name is required.";
  const patch: Partial<CandidateValues> = {};
  for (const f of CANDIDATE_FIELDS) {
    if (f === "candidate_code" || f === "status" || f === "resume_url" || f === "opening_code" || f === "entry_date") continue;
    patch[f] = text(fd, f);
  }
  return applyChange(supabase, user.id, id, patch);
}

export async function setCandidateStatus(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user } = await getHrContext("staff");
  const id = text(fd, "id");
  if (!id) return "Missing candidate.";
  const status = fd.get("status") === "__custom" ? text(fd, "status_custom") : text(fd, "status");
  const err = await applyChange(supabase, user.id, id, { status });
  if (!err) await settleJoining(supabase, id, status);
  return err;
}

/** dd/mm/yyyy or yyyy-mm-dd → yyyy-mm-dd. */
function parseDay(s: string | null): string | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (iso) return s.trim();
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s.trim());
  if (!dmy) return null;
  return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
}

const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );

/** Joining ends the process for that person: record the day, and move the
    opening on — filled only once as many people have joined as were asked for.
    Undoing the status clears it again. */
async function settleJoining(supabase: Supabase, candidateId: string, status: string | null): Promise<void> {
  const stages = await listStages();
  const joined = Boolean(status && stages.find((s) => s.name === status)?.kind === "success");

  const { data: c } = await supabase
    .from("hr_candidates")
    .select("name, opening_id, joined_on, date_of_joining")
    .eq("id", candidateId)
    .maybeSingle();
  if (!c) return;

  if (!joined) {
    if (c.joined_on) await supabase.from("hr_candidates").update({ joined_on: null }).eq("id", candidateId);
    if (c.opening_id) await reopenIfShort(supabase, c.opening_id);
    return;
  }

  const day = parseDay(c.date_of_joining) ?? c.joined_on ?? todayIst();
  await supabase.from("hr_candidates").update({ joined_on: day }).eq("id", candidateId);
  if (!c.opening_id) return;

  const { data: opening } = await supabase
    .from("hr_openings")
    .select("code, status, headcount")
    .eq("id", c.opening_id)
    .maybeSingle();
  if (!opening || opening.status === "cancelled") return;

  const { count } = await supabase
    .from("hr_candidates")
    .select("id", { count: "exact", head: true })
    .eq("opening_id", c.opening_id)
    .not("joined_on", "is", null);
  const joinedCount = count ?? 1;
  const needed = Math.max(1, opening.headcount);
  const complete = joinedCount >= needed;
  const next = complete ? "filled" : "in_progress";
  if (opening.status !== next) await supabase.from("hr_openings").update({ status: next }).eq("id", c.opening_id);

  await notify(await hrStaffIds(), {
    kind: complete ? "opening_filled" : "opening_progress",
    title: complete
      ? `${opening.code} filled — ${c.name} joined`
      : `${c.name} joined ${opening.code} — ${needed - joinedCount} still needed`,
    body: `${joinedCount} of ${needed} joined.`,
    link: `/hr/openings/${c.opening_id}`,
  });
  revalidatePath("/hr/openings", "layout");
}

/** A joining undone (or a joiner untagged) can take an opening back below its
    headcount; it should not stay marked filled. */
async function reopenIfShort(supabase: Supabase, openingId: string): Promise<void> {
  const { data: opening } = await supabase
    .from("hr_openings")
    .select("status, headcount")
    .eq("id", openingId)
    .maybeSingle();
  if (!opening || opening.status !== "filled") return;
  const { count } = await supabase
    .from("hr_candidates")
    .select("id", { count: "exact", head: true })
    .eq("opening_id", openingId)
    .not("joined_on", "is", null);
  if ((count ?? 0) < Math.max(1, opening.headcount)) {
    await supabase.from("hr_openings").update({ status: "in_progress" }).eq("id", openingId);
    revalidatePath("/hr/openings", "layout");
  }
}

export async function setCandidateResume(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user } = await getHrContext("staff");
  const id = text(fd, "id");
  const url = text(fd, "resume_url");
  if (!id) return "Missing candidate.";
  if (url && !isOneDriveLink(url)) return "Resume must be a OneDrive / SharePoint link.";
  return applyChange(supabase, user.id, id, { resume_url: url });
}

export async function setCandidateOpening(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user } = await getHrContext("staff");
  const id = text(fd, "id");
  if (!id) return "Missing candidate.";
  const code = text(fd, "opening_code")?.toUpperCase() ?? null;
  if (code && !(await openingIdFor(supabase, code))) return `Opening ${code} doesn't exist.`;
  return applyChange(supabase, user.id, id, { opening_code: code });
}

/** From an opening's page: tag a candidate by Candidate ID. */
export async function tagCandidateToOpening(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user } = await getHrContext("staff");
  const openingCode = text(fd, "opening_code")?.toUpperCase();
  const candidateCode = text(fd, "candidate_code")?.toUpperCase();
  if (!openingCode || !candidateCode) return "Enter a Candidate ID.";
  const { data: c } = await supabase.from("hr_candidates").select("id").eq("candidate_code", candidateCode).maybeSingle();
  if (!c) return `No candidate with ID ${candidateCode}.`;
  const r = await applyChange(supabase, user.id, c.id, { opening_code: openingCode });
  revalidatePath("/hr/openings", "layout");
  return r;
}

/** The HR block at the foot of the evaluation form. App-only: these fields
    aren't columns in the Excel. */
export async function saveHrDecision(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase } = await getHrContext("staff");
  const id = text(fd, "id");
  if (!id) return "Missing candidate.";
  const { error } = await supabase
    .from("hr_candidates")
    .update({
      offered_salary: text(fd, "offered_salary"),
      date_of_joining: text(fd, "date_of_joining"),
      hr_comments: text(fd, "hr_comments"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return error.message;
  // Keep the joining day in step with the date HR just typed.
  const { data: c } = await supabase.from("hr_candidates").select("status").eq("id", id).maybeSingle();
  await settleJoining(supabase, id, c?.status ?? null);
  revalidateHr(id);
  return "Saved.";
}

/* ---------------- interview panels ---------------- */

async function notifyInterviewers(
  supabase: Supabase,
  interviewerIds: string[],
  candidateId: string,
  round: number,
  scheduledAt: string | null,
  mode: string | null,
) {
  const { data: c } = await supabase.from("hr_candidates").select("name, designation").eq("id", candidateId).maybeSingle();
  const when = scheduledAt
    ? new Date(scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })
    : "time not set";
  await notify(interviewerIds, {
    kind: "interview_assigned",
    title: `New interview: ${c?.name ?? "a candidate"}${c?.designation ? ` (${c.designation})` : ""}`,
    body: `Round ${round} · ${when}${mode ? ` · ${mode}` : ""}`,
    link: `/hr/candidates/${candidateId}`,
  });
}

/** Error message if any of these users lacks Interviewer access. */
async function nonInterviewers(ids: string[]): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id, full_name, role, hr_interviewer").in("id", ids);
  const bad = (data ?? []).filter((p) => p.role !== "superadmin" && !p.hr_interviewer);
  if ((data ?? []).length !== ids.length) return "Some selected people no longer exist.";
  return bad.length ? `${bad.map((p) => p.full_name ?? "A user").join(", ")} doesn't have Interviewer access.` : null;
}

export async function assignPanel(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user, access } = await getHrContext("any");
  const candidate_id = text(fd, "candidate_id");
  const interviewers = [...new Set(fd.getAll("interviewer_id").map(String).filter(Boolean))];
  if (!candidate_id) return "Missing candidate.";
  if (!interviewers.length) return "Choose at least one interviewer.";

  const notInterviewers = await nonInterviewers(interviewers);
  if (notInterviewers) return notInterviewers;

  const round = Number(text(fd, "round") ?? 1) || 1;
  const { data: existing } = await supabase
    .from("hr_interviews")
    .select("state, round, interviewer_id")
    .eq("candidate_id", candidate_id);
  const rounds = existing ?? [];

  // A round where everyone has already given feedback is finished; more
  // interviewers belong in a new round.
  const liveSameRound = rounds.filter((r) => r.round === round && r.state !== "cancelled");
  if (liveSameRound.length && liveSameRound.every((r) => r.state === "completed")) {
    return `Round ${round} is already finished — start the next round instead.`;
  }

  // An interviewer on this candidate can pass them on to the next round, but
  // nothing else: no adding people to a round already under way, and only for
  // a candidate they have actually interviewed.
  const asInterviewer = !access.hrStaff;
  if (asInterviewer) {
    if (!rounds.some((r) => r.interviewer_id === user.id && r.state !== "cancelled")) {
      return "Only HR, or an interviewer on this candidate, can send them for an interview.";
    }
    const highest = Math.max(0, ...rounds.filter((r) => r.state !== "cancelled").map((r) => r.round));
    if (round <= highest) return "You can only set up the next round. Ask HR to change a round already under way.";
  }

  const panel_id = crypto.randomUUID();
  const shared = {
    candidate_id,
    panel_id,
    round,
    scheduled_at: istToIso(text(fd, "scheduled_at")),
    mode: text(fd, "mode"),
    hr_note: text(fd, "hr_note"),
    assigned_by: user.id,
  };
  // Interviewers have no insert rights of their own, so their round goes in
  // through the service role after the checks above.
  const writer = asInterviewer ? (createAdminClient() as unknown as Supabase) : supabase;
  const { error } = await writer.from("hr_interviews").insert(interviewers.map((interviewer_id) => ({ ...shared, interviewer_id })));
  if (error) return error.message;

  await notifyInterviewers(supabase, interviewers, candidate_id, shared.round, shared.scheduled_at, shared.mode);
  if (asInterviewer) {
    const { data: c } = await supabase.from("hr_candidates").select("name").eq("id", candidate_id).maybeSingle();
    const people = await listPeople();
    await notify(await hrStaffIds(), {
      kind: "interview_assigned",
      title: `Round ${round} set up for ${c?.name ?? "a candidate"}`,
      body: `By ${people.find((p) => p.id === user.id)?.name ?? "an interviewer"} · ${interviewers
        .map((i) => people.find((p) => p.id === i)?.name ?? "someone")
        .join(", ")}`,
      link: `/hr/candidates/${candidate_id}`,
    });
  }

  revalidateHr(candidate_id);
  return null;
}

export async function addPanelInterviewer(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user } = await getHrContext("staff");
  const panel_id = text(fd, "panel_id");
  const interviewer_id = text(fd, "interviewer_id");
  if (!panel_id || !interviewer_id) return "Choose an interviewer.";

  const notInterviewer = await nonInterviewers([interviewer_id]);
  if (notInterviewer) return notInterviewer;

  const { data: panel } = await supabase
    .from("hr_interviews")
    .select("candidate_id, round, scheduled_at, mode, hr_note, interviewer_id, state")
    .eq("panel_id", panel_id);
  if (!panel?.length) return "Panel not found.";
  if (panel.some((p) => p.interviewer_id === interviewer_id && p.state !== "cancelled")) return "Already on this panel.";
  const livePanel = panel.filter((p) => p.state !== "cancelled");
  if (livePanel.length && livePanel.every((p) => p.state === "completed")) {
    return `Round ${panel[0].round} is already finished — start the next round instead.`;
  }

  const base = panel[0];
  const { error } = await supabase.from("hr_interviews").insert({
    panel_id,
    interviewer_id,
    candidate_id: base.candidate_id,
    round: base.round,
    scheduled_at: base.scheduled_at,
    mode: base.mode,
    hr_note: base.hr_note,
    assigned_by: user.id,
  });
  if (error) return error.message;
  await notifyInterviewers(supabase, [interviewer_id], base.candidate_id, base.round, base.scheduled_at, base.mode);
  revalidateHr(base.candidate_id);
  return null;
}

/** Remove one interviewer who hasn't submitted yet. */
export async function removePanelInterviewer(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase } = await getHrContext("staff");
  const id = text(fd, "id");
  if (!id) return "Missing interview.";
  const { data: iv } = await supabase.from("hr_interviews").select("candidate_id, state").eq("id", id).maybeSingle();
  if (!iv) return "Not found.";
  if (iv.state === "completed") return "Feedback was already submitted; it can't be removed.";
  const { error } = await supabase.from("hr_interviews").delete().eq("id", id);
  if (error) return error.message;
  revalidateHr(iv.candidate_id);
  return null;
}

export async function cancelPanel(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase } = await getHrContext("staff");
  const panel_id = text(fd, "panel_id");
  const candidate_id = text(fd, "candidate_id") ?? undefined;
  if (!panel_id) return "Missing panel.";
  const { error } = await supabase
    .from("hr_interviews")
    .update({ state: "cancelled" })
    .eq("panel_id", panel_id)
    .eq("state", "assigned");
  if (error) return error.message;
  revalidateHr(candidate_id);
  return null;
}

const RECOMMENDATIONS = ["hire", "reject", "hold", "next_round"];

function scoresFromForm(fd: FormData): Scores {
  const out: Record<string, number> = {};
  for (const skill of SKILLS) {
    const n = Number(fd.get(`score_${skill.id}`));
    if (n >= 1 && n <= 5) out[skill.id] = n;
  }
  return parseScores(out);
}

/** Save the evaluation form without submitting it, so an interview can be
    filled in as it happens and finished later. */
export async function saveEvaluationDraft(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user } = await getHrContext("interviewer");
  const id = text(fd, "id");
  if (!id) return "Missing interview.";

  const { data: iv } = await supabase.from("hr_interviews").select("interviewer_id, state").eq("id", id).maybeSingle();
  if (!iv) return "Interview not found.";
  if (iv.interviewer_id !== user.id) return "Only the assigned interviewer can fill this in.";
  if (iv.state === "cancelled") return "This interview was cancelled.";

  const { error } = await supabase
    .from("hr_interviews")
    .update({
      scores: scoresFromForm(fd),
      feedback: text(fd, "feedback"),
      rating: Number(text(fd, "rating")) || null,
      recommendation: text(fd, "recommendation"),
      draft_saved_at: new Date().toISOString(),
    })
    .eq("id", id);
  return error ? error.message : null;
}

/** Once every interviewer on a round has submitted, move the candidate's
    status on: cleared puts them on that round's stage, a rejection on the
    stage that closes it. HR is told either way and can still change it. */
async function advanceAfterPanel(
  supabase: Supabase,
  userId: string,
  candidateId: string,
  panelId: string,
): Promise<void> {
  const { data: panel } = await supabase
    .from("hr_interviews")
    .select("round, state, recommendation")
    .eq("panel_id", panelId);
  const live = (panel ?? []).filter((r) => r.state !== "cancelled");
  if (!live.length || live.some((r) => r.state !== "completed")) return;

  const verdict = panelVerdict(live.map((r) => r.recommendation));
  const status = nextStatus(await listStages(), live[0].round, verdict);
  if (!status) return;

  const admin = createAdminClient() as unknown as Supabase;
  const { data: c } = await admin.from("hr_candidates").select("name, status").eq("id", candidateId).maybeSingle();
  if (!c || c.status === status) return;

  // The interviewer has no write access to candidates, so this goes through the
  // service role. A failure here must not lose the feedback that was just given.
  const err = await applyChange(admin, userId, candidateId, { status });
  await notify(await hrStaffIds(), {
    kind: "interview_result",
    title: err
      ? `${c.name}: status not updated automatically`
      : `${c.name} moved to ${status}`,
    body: err
      ? `Round ${live[0].round} was ${verdict}. ${err}`
      : `Round ${live[0].round} ${verdict === "cleared" ? "cleared" : "rejected"} · was ${c.status ?? "no status"}`,
    link: `/hr/candidates/${candidateId}`,
  });
}

/** Interviewer feedback. The candidate's status follows the panel's verdict. */
export async function submitFeedback(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user } = await getHrContext("interviewer");
  const id = text(fd, "id");
  const feedback = text(fd, "feedback");
  const recommendation = text(fd, "recommendation");
  const rating = Number(text(fd, "rating"));
  if (!id) return "Missing interview.";
  if (!feedback) return "Write your feedback.";
  if (!recommendation || !RECOMMENDATIONS.includes(recommendation)) return "Choose a recommendation.";
  if (!(rating >= 1 && rating <= 5)) return "Give a rating from 1 to 5.";

  const { data: iv } = await supabase
    .from("hr_interviews")
    .select("id, interviewer_id, candidate_id, state, panel_id, round")
    .eq("id", id)
    .maybeSingle();
  if (!iv) return "Interview not found.";
  if (iv.interviewer_id !== user.id) return "Only the assigned interviewer can submit feedback.";
  if (iv.state === "cancelled") return "This interview was cancelled.";

  const { error } = await supabase
    .from("hr_interviews")
    .update({
      feedback,
      recommendation,
      rating,
      scores: scoresFromForm(fd),
      state: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return error.message;

  await advanceAfterPanel(supabase, user.id, iv.candidate_id, iv.panel_id).catch((e) =>
    console.error("status not advanced:", errMsg(e)),
  );

  revalidateHr(iv.candidate_id);
  return null;
}

/* ---------------- openings ---------------- */

export async function createOpening(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, user, access } = await getHrContext("any");
  if (!access.planning) return "Only planning users can raise openings.";

  const chosen = text(fd, "designation");
  const designation = chosen === "__other" ? text(fd, "designation_other") : chosen;
  const headcount = Number(text(fd, "headcount") ?? 1);
  if (!designation) return "Designation is required.";
  if (!(headcount >= 1)) return "Headcount must be at least 1.";

  // Codes are sequential; retry on the rare collision of two at once.
  const admin = createAdminClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await admin.from("hr_openings").select("code").order("code", { ascending: false }).limit(1);
    const n = Number(/(\d+)$/.exec(last?.[0]?.code ?? "")?.[1] ?? 0) + 1 + attempt;
    const code = `OPN-${String(n).padStart(4, "0")}`;
    const { data, error } = await supabase
      .from("hr_openings")
      .insert({
        code,
        designation,
        project_id: text(fd, "project_id"),
        headcount,
        required_by: text(fd, "required_by"),
        experience: text(fd, "experience"),
        salary_range: text(fd, "salary_range"),
        description: text(fd, "description"),
        priority: text(fd, "priority") ?? "normal",
        raised_by: user.id,
      })
      .select("id")
      .single();
    if (!error) {
      const { data: raiser } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      await notify(
        (await hrStaffIds()).filter((id) => id !== user.id),
        {
          kind: "opening_raised",
          title: `New opening ${code}: ${designation} ×${headcount}`,
          body: `Raised by ${raiser?.full_name ?? "planning"}${text(fd, "required_by") ? ` · needed by ${text(fd, "required_by")}` : ""}`,
          link: `/hr/openings/${data.id}`,
        },
      );
      revalidatePath("/hr/openings", "layout");
      redirect(`/hr/openings/${data.id}`);
    }
    if (error.code !== "23505") return error.message;
  }
  return "Could not allocate an opening code, try again.";
}

export async function setOpeningStatus(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase } = await getHrContext("staff");
  const id = text(fd, "id");
  const status = text(fd, "status");
  if (!id || !status || !["open", "in_progress", "filled", "cancelled"].includes(status)) return "Invalid status.";
  const { error } = await supabase
    .from("hr_openings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return error.message;
  revalidatePath("/hr/openings", "layout");
  return null;
}

/* ---------------- stages ---------------- */

export async function saveStages(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase } = await getHrContext("staff");
  const names = fd.getAll("name").map(String);
  const rows = names.map((name, i) => ({
    name,
    sort_order: Number(fd.getAll("sort_order")[i]) || 1000,
    kind: String(fd.getAll("kind")[i] ?? "active"),
  }));
  const { error } = await supabase.from("hr_stages").upsert(rows, { onConflict: "name" });
  if (error) return error.message;
  revalidateHr();
  return "Saved.";
}

/** A new status HR can pick before any candidate has it in the Excel. */
export async function addStage(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase } = await getHrContext("staff");
  const name = text(fd, "name");
  const kind = text(fd, "kind") ?? "active";
  if (!name) return "Enter a status name.";
  if (!["active", "hold", "success", "closed"].includes(kind)) return "Invalid kind.";
  const { data: existing } = await supabase.from("hr_stages").select("name").ilike("name", name).maybeSingle();
  if (existing) return `"${existing.name}" already exists.`;
  const { error } = await supabase.from("hr_stages").insert({ name, kind });
  if (error) return error.message;
  revalidateHr();
  return "Added.";
}

/* ---------------- sync & settings ---------------- */

export async function syncNow(): Promise<string | null> {
  await getHrContext("staff");
  try {
    const r = await syncFromExcel();
    revalidateHr();
    if (r.skipped) return "A sync is already running — try again in a minute.";
    return (
      `Synced: ${r.rows} rows read, ${r.changed} updated` +
      (r.idsAssigned ? `, ${r.idsAssigned} new IDs written` : "") +
      (r.pushed ? `, ${r.pushed} app candidates added to the Excel` : "") +
      "."
    );
  } catch (e) {
    revalidateHr();
    return `Sync failed: ${errMsg(e)}`;
  }
}

export async function saveWorkbook(_prev: string | null, fd: FormData): Promise<string | null> {
  await getHrContext("staff");
  const workbook_url = text(fd, "workbook_url");
  const sheetWanted = text(fd, "sheet_name");
  if (!workbook_url) return "Paste the Excel share link.";

  const conn = await getConnection();
  if (!conn?.refresh_token) return "Connect the Microsoft account first.";

  try {
    const item = await resolveShareUrl(workbook_url);
    const sheets = await listWorksheets(item.parentReference.driveId, item.id);
    const sheet_name = sheetWanted ? sheets.find((s) => s.toLowerCase() === sheetWanted.toLowerCase()) : sheets[0];
    if (!sheet_name) return `Sheet "${sheetWanted}" not found. Sheets in this file: ${sheets.join(", ")}.`;

    const admin = createAdminClient();
    const { error } = await admin
      .from("hr_ms_connection")
      .update({
        workbook_url,
        drive_id: item.parentReference.driveId,
        item_id: item.id,
        sheet_name,
        last_synced_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) return error.message;
  } catch (e) {
    return `Could not open that file: ${errMsg(e)}`;
  }

  revalidatePath("/hr/settings");
  return syncNow();
}

export async function disconnectMicrosoft(): Promise<string | null> {
  await getHrContext("staff");
  const admin = createAdminClient();
  const { error } = await admin
    .from("hr_ms_connection")
    .update({ refresh_token: null, account_email: null, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return error.message;
  forgetCachedToken();
  revalidatePath("/hr/settings");
  return null;
}
