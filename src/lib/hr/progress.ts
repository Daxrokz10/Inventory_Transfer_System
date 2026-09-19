import { createClient } from "@/lib/supabase/server";
import { listPeople } from "@/lib/hr/people";
import { buildTimeline, type TimelineEvent } from "@/app/(app)/hr/Timeline";

/* Timelines for a list of candidates in two queries (status history and
   interviews for all of them at once), so the status page can show each
   candidate's journey without a query per row. */

export type CandidateRow = {
  id: string;
  candidate_code: string;
  name: string;
  designation: string | null;
  status: string | null;
  entry_date: string | null;
  created_at: string;
  opening_id: string | null;
  joined_on?: string | null;
  date_of_joining?: string | null;
};

type Opening = { id: string; code: string; designation: string; headcount: number; created_at: string; raised_by: string | null };

export async function buildTimelines(
  candidates: CandidateRow[],
  openings: Opening[] = [],
  // Planning users can't read candidates' history under RLS; the opening page
  // passes the service-role client for them, after checking the opening is theirs.
  client?: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, TimelineEvent[]>> {
  const out = new Map<string, TimelineEvent[]>();
  if (candidates.length === 0) return out;

  const supabase = client ?? (await createClient());
  const ids = candidates.map((c) => c.id);
  const [{ data: history }, { data: interviews }, people] = await Promise.all([
    supabase
      .from("hr_status_history")
      .select("candidate_id, from_status, to_status, source, changed_by, changed_at")
      .in("candidate_id", ids)
      .order("changed_at"),
    supabase
      .from("hr_interviews")
      .select("candidate_id, panel_id, interviewer_id, round, scheduled_at, mode, state, recommendation, rating, completed_at, created_at")
      .in("candidate_id", ids)
      .order("round"),
    listPeople(),
  ]);

  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const openingById = new Map(openings.map((o) => [o.id, o]));

  const historyBy = new Map<string, NonNullable<typeof history>>();
  for (const h of history ?? []) historyBy.set(h.candidate_id, [...(historyBy.get(h.candidate_id) ?? []), h]);

  // candidate → panel → its interviewers
  const panelsBy = new Map<string, Map<string, NonNullable<typeof interviews>>>();
  for (const iv of interviews ?? []) {
    const byPanel = panelsBy.get(iv.candidate_id) ?? new Map();
    byPanel.set(iv.panel_id, [...(byPanel.get(iv.panel_id) ?? []), iv]);
    panelsBy.set(iv.candidate_id, byPanel);
  }

  for (const c of candidates) {
    const panels = [...(panelsBy.get(c.id)?.values() ?? [])]
      .sort((a, b) => a[0].round - b[0].round || a[0].created_at.localeCompare(b[0].created_at))
      .map((members) => ({
        panel_id: members[0].panel_id,
        round: members[0].round,
        scheduled_at: members[0].scheduled_at,
        mode: members[0].mode,
        created_at: members[0].created_at,
        members: members.map((m) => ({
          name: nameOf.get(m.interviewer_id) ?? "Unknown",
          state: m.state,
          recommendation: m.recommendation,
          rating: m.rating,
          completed_at: m.completed_at,
        })),
      }));

    const opening = c.opening_id ? openingById.get(c.opening_id) : undefined;
    out.set(
      c.id,
      buildTimeline({
        candidate: { entry_date: c.entry_date, created_at: c.created_at, status: c.status, name: c.name },
        opening: opening
          ? { ...opening, raiser: opening.raised_by ? (nameOf.get(opening.raised_by) ?? null) : null }
          : null,
        history: historyBy.get(c.id) ?? [],
        panels,
        nameOf,
      }),
    );
  }
  return out;
}
