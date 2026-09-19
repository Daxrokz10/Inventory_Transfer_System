import Link from "next/link";
import { after } from "next/server";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/cn";
import { getHrContext } from "@/lib/hr/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { OPENING_STATUS_LABEL, getStages, joiningStages } from "@/lib/hr/data";
import {
  OPENING_STATUS_TONE,
  daysAgoIso,
  expectedJoiningNote,
  hiringSummary,
  joiningNote,
  statusTone,
  toIsoDay,
} from "@/lib/hr/format";
import { buildTimelines, type CandidateRow } from "@/lib/hr/progress";
import { syncIfStale } from "@/lib/hr/sync";
import { TimelineStrip } from "../Timeline";
import { ScrollToCard } from "./ScrollToCard";

/* Status = one section per opening, each listing its candidates with the whole
   journey on one line (registered → telephonic → rounds → offer / rejected).
   Candidates HR added without an opening get a section of their own. */

const PER_GROUP = 25;
const RECENT_DAYS = 60;

type Search = { candidate?: string; opening?: string; q?: string; show?: string };

const CANDIDATE_COLUMNS =
  "id, candidate_code, name, designation, status, entry_date, created_at, opening_id, joined_on, date_of_joining";

type OpeningRow = {
  id: string;
  code: string;
  designation: string;
  headcount: number;
  status: string;
  required_by: string | null;
  filled_at?: string | null;
  created_at: string;
  raised_by: string | null;
  project: { code: string; name: string } | null;
};

export default async function StatusPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase, access, user } = await getHrContext("planning");
  const isHr = access.hrStaff;
  // Planning sees the board for the openings they raised, read-only. They can't
  // read candidates under RLS, so those reads go through the service role and
  // are limited to their own openings below.
  const db = isHr ? supabase : (createAdminClient() as unknown as typeof supabase);
  const sp = await searchParams;
  after(() => syncIfStale());

  const q = (sp.q ?? "").trim().replace(/[,()%]/g, " ");
  // Everyone by default, rejected candidates included; the filter narrows it.
  const show = sp.show ?? "all";

  const [stages, { data: openingRows }, focus] = await Promise.all([
    getStages(),
    supabase
      .from("hr_openings")
      .select("id, code, designation, headcount, status, required_by, filled_at, created_at, raised_by, project:project_id(code, name)")
      .order("created_at", { ascending: false })
      .limit(100),
    sp.candidate
      ? db
          .from("hr_candidates")
          .select(CANDIDATE_COLUMNS)
          .eq("id", sp.candidate)
          .maybeSingle()
          .then((r) => r.data as CandidateRow | null)
      : Promise.resolve(null),
  ]);

  const allOpenings = ((openingRows ?? []) as unknown as OpeningRow[]).filter((o) => isHr || o.raised_by === user.id);
  // The board is about hiring still under way, plus openings filled in the
  // last two months so a recent hire doesn't vanish the day they join. Older
  // and cancelled ones live on the Openings page. Picking one in the filter
  // still shows it.
  const recentSince = daysAgoIso(RECENT_DAYS);
  const isLive = (o: OpeningRow) => o.status === "open" || o.status === "in_progress" || o.status === "accepted";
  const isRecentlyFilled = (o: OpeningRow) => o.status === "filled" && (!o.filled_at || o.filled_at >= recentSince);
  const openings = allOpenings
    .filter((o) => (sp.opening ? o.code === sp.opening : isLive(o) || isRecentlyFilled(o)))
    // completed ones most recently filled first
    .sort((a, b) => (b.filled_at ?? "").localeCompare(a.filled_at ?? ""));
  const finishedStages = stages.filter((s) => s.kind === "success" || s.kind === "closed").map((s) => s.name);
  const closedStages = stages.filter((s) => s.kind === "closed").map((s) => s.name);
  const inList = (names: string[]) => `(${names.map((n) => `"${n}"`).join(",")})`;

  const fetchGroup = async (openingId: string | null) => {
    let query = db
      .from("hr_candidates")
      .select(CANDIDATE_COLUMNS, { count: "exact" })
      .order("updated_at", { ascending: false })
      .limit(PER_GROUP);
    query = openingId ? query.eq("opening_id", openingId) : query.is("opening_id", null);
    if (q) query = query.or(`name.ilike.%${q}%,candidate_code.ilike.%${q}%,phone.ilike.%${q}%`);
    if (show === "active" && finishedStages.length) {
      query = query.or(`status.is.null,status.not.in.${inList(finishedStages)}`);
    }
    if (show === "rejected" && closedStages.length) {
      query = query.in("status", closedStages);
    }
    const { data, count } = await query;
    return { rows: (data ?? []) as CandidateRow[], total: count ?? 0 };
  };

  // Order on the page: openings still hiring, candidates with no opening,
  // then the openings completed recently.
  const groups: { opening: OpeningRow | null; rows: CandidateRow[]; total: number }[] = [];
  for (const o of openings.filter(isLive)) groups.push({ opening: o, ...(await fetchGroup(o.id)) });
  // Candidates with no opening are HR's pool; planning only sees their own openings.
  if (!sp.opening && isHr) {
    const loose = await fetchGroup(null);
    if (loose.total > 0) groups.push({ opening: null, ...loose });
  }
  for (const o of openings.filter((x) => !isLive(x))) groups.push({ opening: o, ...(await fetchGroup(o.id)) });
  const firstCompleted = groups.findIndex((g) => g.opening && !isLive(g.opening));

  // The candidate jumped to from "Show status" is always shown.
  if (focus && (isHr || allOpenings.some((o) => o.id === focus.opening_id))) {
    const g = groups.find((x) => (x.opening?.id ?? null) === focus.opening_id);
    if (g && !g.rows.some((r) => r.id === focus.id)) g.rows.unshift(focus);
    else if (!g) groups.unshift({ opening: null, rows: [focus], total: 1 });
  }

  // Everyone hired against an opening — joined, or offer accepted and waiting
  // to join — is always shown at the top of it, whatever the filter says: they
  // are what the opening was raised for. Each carries their own date.
  const openingIds = openings.map((o) => o.id);
  const { accepted: acceptedStages } = joiningStages(stages);
  const hireFilter = [
    "joined_on.not.is.null",
    "date_of_joining.not.is.null",
    ...(acceptedStages.length ? [`status.in.${inList(acceptedStages)}`] : []),
  ].join(",");
  const { data: hireRows } = openingIds.length
    ? await db.from("hr_candidates").select(CANDIDATE_COLUMNS).in("opening_id", openingIds).or(hireFilter)
    : { data: [] as CandidateRow[] };
  const hiresBy = new Map<string, CandidateRow[]>();
  // Someone who backed out (Rejected before joining, or any closed stage) is no
  // longer a hire, even with a joining date still on file.
  const closedSet = new Set(closedStages);
  for (const r of (hireRows ?? []) as CandidateRow[]) {
    if (r.opening_id && !(r.status && closedSet.has(r.status))) hiresBy.set(r.opening_id, [...(hiresBy.get(r.opening_id) ?? []), r]);
  }
  // Joined first (by date), then those still to join (by expected date).
  const hireOrder = (a: CandidateRow, b: CandidateRow) =>
    Number(!a.joined_on) - Number(!b.joined_on) ||
    (a.joined_on ?? toIsoDay(a.date_of_joining) ?? "9").localeCompare(b.joined_on ?? toIsoDay(b.date_of_joining) ?? "9");

  const timelines = await buildTimelines(
    [...groups.flatMap((g) => g.rows), ...[...hiresBy.values()].flat()],
    allOpenings,
    isHr ? undefined : db,
  );

  // Only HR can open a candidate; planning sees the name.
  const candidateName = (c: CandidateRow, className: string) =>
    isHr ? (
      <Link href={`/hr/candidates/${c.id}`} className={`${className} text-accent hover:underline`}>
        {c.name}
      </Link>
    ) : (
      <span className={`${className} text-ink`}>{c.name}</span>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Status"
        subtitle={
          isHr
            ? "Openings still being hired for, and how far each candidate has got."
            : "The openings you raised, and how far each candidate has got."
        }
        actions={
          isHr ? (
            <Link href="/hr/settings#stages" className="text-sm font-medium text-accent hover:underline">
              Order stages
            </Link>
          ) : undefined
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-2">
        {sp.candidate && <input type="hidden" name="candidate" value={sp.candidate} />}
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, phone, ID" className="w-64" />
        <Select name="opening" defaultValue={sp.opening ?? ""}>
          <option value="">All openings</option>
          {allOpenings.map((o) => (
            <option key={o.code} value={o.code}>
              {o.code} · {o.designation}
            </option>
          ))}
        </Select>
        <Select name="show" defaultValue={show}>
          <option value="all">Everyone</option>
          <option value="active">In process only</option>
          <option value="rejected">Rejected / closed only</option>
        </Select>
        <button className="rounded-md border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
          Apply
        </button>
        {(sp.q || sp.opening || sp.show) && (
          <Link href="/hr/status" className="px-2 py-2 text-sm text-ink-2 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {groups.length === 0 && (
        <Card>
          <p className="text-sm text-ink-2">
No openings are being hired for right now. Planning raises them from the Openings page; filled ones keep their
            full timeline there, and candidates without an opening appear here too.
          </p>
        </Card>
      )}

      {groups.map((g, gi) => {
        const hires = [...((g.opening ? hiresBy.get(g.opening.id) : undefined) ?? [])].sort(hireOrder);
        const hireIds = new Set(hires.map((j) => j.id));
        const rest = g.rows.filter((c) => !hireIds.has(c.id));
        const joinedCount = hires.filter((h) => h.joined_on).length;
        return (
        <div key={g.opening?.id ?? "none"} className="space-y-3">
        {gi === firstCompleted && (
          <div className="pt-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-3">Completed in the last 2 months</h2>
            <p className="text-xs text-ink-3">Filled openings stay here for {RECENT_DAYS} days, then move to the Openings page.</p>
          </div>
        )}
        <Card className="p-0">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            {g.opening ? (
              <div>
                <Link href={`/hr/openings/${g.opening.id}`} className="font-semibold text-accent hover:underline">
                  {g.opening.code} · {g.opening.designation}
                </Link>
                <p className="text-xs text-ink-2">
                  {g.opening.project ? `${g.opening.project.code} · ` : ""}
                  {hiringSummary(g.opening.headcount, joinedCount, hires.length - joinedCount)}{" "}
                  · raised{" "}
                  {new Date(g.opening.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-ink">Not linked to an opening</p>
                <p className="text-xs text-ink-2">Candidates added without a requirement from planning</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              {g.opening && (
                <Badge tone={OPENING_STATUS_TONE[g.opening.status]}>{OPENING_STATUS_LABEL[g.opening.status]}</Badge>
              )}
              <span className="text-xs text-ink-2">
                {g.rows.length < g.total
                  ? `${g.rows.length} of ${g.total.toLocaleString("en-IN")}`
                  : g.total.toLocaleString("en-IN")}{" "}
                candidate{g.total === 1 ? "" : "s"}
              </span>
            </div>
          </header>

          {hires.map((joined) => {
            const requiredBy = g.opening?.required_by ?? null;
            const note = joined.joined_on
              ? joiningNote(joined.joined_on, requiredBy)
              : (expectedJoiningNote(joined.date_of_joining, requiredBy) ?? {
                  text: "Offer accepted — joining date not set",
                  tone: "warn" as const,
                });
            return (
            <section
              key={joined.id}
              id={`cand-${joined.id}`}
              className={cn("border-b border-line px-5 py-4", joined.joined_on ? "bg-good-soft/40" : "bg-accent-soft/30")}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  {candidateName(joined, "font-semibold")}
                  <span className="ml-2 text-ink-2">{joined.designation ?? "—"}</span>
                  <span className="ml-2 font-mono text-[11px] text-ink-3">{joined.candidate_code}</span>
                </p>
                {note && <Badge tone={note.tone}>{note.text}</Badge>}
              </div>
              <p className="mt-1 mb-2 text-xs text-ink-2">
                {joined.joined_on ? "Joined against this opening" : "Accepted the offer, still to join"} ·{" "}
                {g.opening && (
                  <Link href={`/hr/openings/${g.opening.id}`} className="text-accent hover:underline">
                    full timeline on the opening →
                  </Link>
                )}
              </p>
              <TimelineStrip events={timelines.get(joined.id) ?? []} />
            </section>
            );
          })}

          <ul className="divide-y divide-line">
            {rest.length === 0 && hires.length === 0 && (
              <li className="px-5 py-4 text-sm text-ink-2">No candidates for this filter.</li>
            )}
            {rest.map((c) => (
              <li
                key={c.id}
                id={`cand-${c.id}`}
                className={cn("space-y-2 px-5 py-4", c.id === focus?.id && "bg-accent-soft/40")}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm">
                    {candidateName(c, "font-medium")}
                    <span className="ml-2 text-ink-2">{c.designation ?? "—"}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-3">{c.candidate_code}</span>
                  </p>
                  {c.status ? <Badge tone={statusTone(c.status)}>{c.status}</Badge> : <Badge>No status</Badge>}
                </div>
                <TimelineStrip events={timelines.get(c.id) ?? []} />
              </li>
            ))}
          </ul>

          {g.rows.length < g.total && (
            <div className="border-t border-line px-5 py-2.5">
              <Link
                href={
                  !isHr && g.opening ? `/hr/openings/${g.opening.id}` : g.opening ? `/hr?opening=${g.opening.code}` : "/hr"
                }
                className="text-xs font-medium text-accent hover:underline"
              >
                See all {g.total.toLocaleString("en-IN")} {isHr ? "in the candidate list" : "on the opening"} →
              </Link>
            </div>
          )}
        </Card>
        </div>
        );
      })}

      {focus && <ScrollToCard id={`cand-${focus.id}`} />}
    </div>
  );
}
