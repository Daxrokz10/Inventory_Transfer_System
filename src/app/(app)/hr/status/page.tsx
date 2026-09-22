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
import { OPENING_STATUS_TONE, daysAgoIso, hireNotes, statusTone, toIsoDay } from "@/lib/hr/format";
import { buildTimelines, offerAcceptedDates, type CandidateRow } from "@/lib/hr/progress";
import { syncIfStale } from "@/lib/hr/sync";
import { TimelineStrip } from "../Timeline";
import { ScrollToCard } from "./ScrollToCard";
import { DueChip, Funnel, HiringBar, Stat } from "./StatusParts";

/* The status board, written to be understood at a glance: the totals first,
   then one card per opening — who is hired, how the requirement is going, and
   where its candidates stand. The candidate-by-candidate detail is folded away
   behind "show candidates". */

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
    .sort((a, b) => (b.filled_at ?? "").localeCompare(a.filled_at ?? ""));

  const stageOrder = new Map(stages.map((s, i) => [s.name, i]));
  const kindOf = new Map(stages.map((s) => [s.name, s.kind]));
  const finishedStages = stages.filter((s) => s.kind === "success" || s.kind === "closed").map((s) => s.name);
  const closedStages = stages.filter((s) => s.kind === "closed").map((s) => s.name);
  const closedSet = new Set(closedStages);
  const inList = (names: string[]) => `(${names.map((n) => `"${n}"`).join(",")})`;
  const { accepted: acceptedStages, joined: joinedStage } = joiningStages(stages);
  const openingIds = openings.map((o) => o.id);

  /* ---- what each opening's candidates are doing, in counts ---- */
  const { data: stageCounts } = openingIds.length
    ? await createAdminClient().from("hr_opening_status_counts").select("opening_id, status, n").in("opening_id", openingIds)
    : { data: [] as { opening_id: string; status: string | null; n: number }[] };
  const countsBy = new Map<string, { byStatus: Map<string, number>; closed: number; inProcess: number; total: number }>();
  for (const row of stageCounts ?? []) {
    const c = countsBy.get(row.opening_id) ?? { byStatus: new Map<string, number>(), closed: 0, inProcess: 0, total: 0 };
    const name = row.status ?? "";
    c.byStatus.set(name, (c.byStatus.get(name) ?? 0) + row.n);
    c.total += row.n;
    const kind = row.status ? kindOf.get(row.status) : undefined;
    if (kind === "closed") c.closed += row.n;
    else if (kind !== "success") c.inProcess += row.n;
    countsBy.set(row.opening_id, c);
  }

  /* ---- the pipeline, stage by stage ----
     Steps are the stages that mean progress (a rejection ends the journey, it
     isn't a step). "Reached" counts everyone whose status is that stage or any
     later one, so someone rejected after the technical round still counts as
     having reached it — the numbers fall exactly where people drop out. */
  const funnelStages = stages.filter((st) => st.kind === "active" || st.kind === "success");
  // The rejection stages that end a journey at each step: those sitting between
  // this step and the next one in the stage order (Technical Rejection belongs
  // to Tecnical Round). Anyone without a status who was rejected sits under
  // "Registered".
  const rejectionsFor = (stepOrder: number, nextOrder: number) =>
    stages.filter((st) => st.kind === "closed" && (stageOrder.get(st.name) ?? 0) > stepOrder && (stageOrder.get(st.name) ?? 0) < nextOrder);

  const funnelFor = (openingId: string, total: number) => {
    const byStatus = countsBy.get(openingId)?.byStatus ?? new Map<string, number>();
    const reachedFrom = (order: number) =>
      [...byStatus.entries()].reduce((n, [name, count]) => n + ((stageOrder.get(name) ?? -1) >= order ? count : 0), 0);
    const orders = funnelStages.map((st) => stageOrder.get(st.name) ?? 0);
    const rejectedBetween = (from: number, to: number) =>
      rejectionsFor(from, to).reduce((n, st) => n + (byStatus.get(st.name) ?? 0), 0);
    return [
      {
        name: "Registered",
        reached: total,
        here: byStatus.get("") ?? 0,
        rejected: rejectedBetween(-1, orders[0] ?? Number.MAX_SAFE_INTEGER),
      },
      ...funnelStages.map((st, i) => ({
        name: st.name,
        reached: reachedFrom(orders[i]),
        here: byStatus.get(st.name) ?? 0,
        rejected: rejectedBetween(orders[i], orders[i + 1] ?? Number.MAX_SAFE_INTEGER),
        final: st.kind === "success",
      })),
    ];
  };

  /* ---- interviews still waiting on their interviewer ---- */
  const { data: pendingRows } = openingIds.length
    ? await db
        .from("hr_interviews")
        .select("id, candidate:candidate_id!inner(opening_id)")
        .eq("state", "assigned")
        .in("candidate.opening_id", openingIds)
    : { data: [] as { id: string; candidate: { opening_id: string } | null }[] };
  const awaitingBy = new Map<string, number>();
  for (const r of (pendingRows ?? []) as unknown as { candidate: { opening_id: string } | null }[]) {
    const id = r.candidate?.opening_id;
    if (id) awaitingBy.set(id, (awaitingBy.get(id) ?? 0) + 1);
  }

  /* ---- everyone hired: joined, or offer accepted and waiting to join ---- */
  const hireFilter = [
    "joined_on.not.is.null",
    "date_of_joining.not.is.null",
    ...(acceptedStages.length ? [`status.in.${inList(acceptedStages)}`] : []),
    ...(joinedStage ? [`status.eq."${joinedStage}"`] : []),
  ].join(",");
  const { data: hireRows } = openingIds.length
    ? await db.from("hr_candidates").select(CANDIDATE_COLUMNS).in("opening_id", openingIds).or(hireFilter)
    : { data: [] as CandidateRow[] };
  const hiresBy = new Map<string, CandidateRow[]>();
  // Someone who backed out (Rejected before joining, or any closed stage) is no
  // longer a hire, even with a joining date still on file.
  for (const r of (hireRows ?? []) as CandidateRow[]) {
    if (r.opening_id && !(r.status && closedSet.has(r.status))) {
      hiresBy.set(r.opening_id, [...(hiresBy.get(r.opening_id) ?? []), r]);
    }
  }
  // Joined first (by date), then those still to join (by expected date).
  const hireOrder = (a: CandidateRow, b: CandidateRow) =>
    Number(!a.joined_on) - Number(!b.joined_on) ||
    (a.joined_on ?? toIsoDay(a.date_of_joining) ?? "9").localeCompare(b.joined_on ?? toIsoDay(b.date_of_joining) ?? "9");

  /* ---- the candidate lists behind "show candidates" ---- */
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
    if (show === "rejected" && closedStages.length) query = query.in("status", closedStages);
    const { data, count } = await query;
    return { rows: (data ?? []) as CandidateRow[], total: count ?? 0 };
  };

  // Order on the page: openings still hiring, candidates with no opening, then
  // the openings completed recently.
  const groups: { opening: OpeningRow | null; rows: CandidateRow[]; total: number }[] = [];
  for (const o of openings.filter(isLive)) groups.push({ opening: o, ...(await fetchGroup(o.id)) });
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

  const [timelines, offerDates] = await Promise.all([
    buildTimelines([...groups.flatMap((g) => g.rows), ...[...hiresBy.values()].flat()], allOpenings, isHr ? undefined : db),
    offerAcceptedDates(
      [...hiresBy.values()].flat().map((h) => h.id),
      acceptedStages,
      isHr ? undefined : db,
    ),
  ]);

  /* ---- the numbers at the top ---- */
  const live = openings.filter(isLive);
  const allHires = [...hiresBy.entries()].filter(([id]) => live.some((o) => o.id === id)).flatMap(([, v]) => v);
  const totals = {
    openings: live.length,
    needed: live.reduce((n, o) => n + Math.max(1, o.headcount), 0),
    joined: allHires.filter((h) => h.joined_on).length,
    toJoin: allHires.filter((h) => !h.joined_on).length,
    inProcess: live.reduce((n, o) => n + (countsBy.get(o.id)?.inProcess ?? 0), 0),
    overdue: live.filter((o) => {
      const hires = hiresBy.get(o.id) ?? [];
      return o.required_by && new Date(o.required_by) < new Date() && hires.length < Math.max(1, o.headcount);
    }).length,
  };

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
        title="Hiring status"
        subtitle={
          isHr
            ? "Where every open requirement stands today."
            : "Where the requirements you raised stand today."
        }
        actions={
          isHr ? (
            <Link href="/hr/settings#stages" className="text-sm font-medium text-accent hover:underline">
              Order stages
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Hiring for" value={totals.openings} hint={`${totals.needed} ${totals.needed === 1 ? "person" : "people"} needed`} />
        <Stat label="Joined" value={totals.joined} tone={totals.joined ? "good" : "plain"} hint="against these openings" />
        <Stat label="Still to join" value={totals.toJoin} hint="offer accepted" />
        <Stat label="In process" value={totals.inProcess} hint="candidates being interviewed" />
        <Stat
          label="Overdue"
          value={totals.overdue}
          tone={totals.overdue ? "danger" : "plain"}
          hint="past the date needed"
        />
      </div>

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
            Nothing is being hired for right now. Planning raises requirements from the Openings page; filled ones keep
            their full timeline there, and candidates without an opening appear here too.
          </p>
        </Card>
      )}

      {groups.map((g, gi) => {
        const o = g.opening;
        const hires = [...((o ? hiresBy.get(o.id) : undefined) ?? [])].sort(hireOrder);
        const hireIds = new Set(hires.map((h) => h.id));
        const rest = g.rows.filter((c) => !hireIds.has(c.id));
        const joined = hires.filter((h) => h.joined_on).length;
        const needed = Math.max(1, o?.headcount ?? 1);
        const stillToHire = Math.max(0, needed - hires.length);
        const counts = o ? countsBy.get(o.id) : undefined;
        const awaiting = o ? (awaitingBy.get(o.id) ?? 0) : 0;
        const focusHere = Boolean(focus && g.rows.some((r) => r.id === focus.id));

        return (
          <div key={o?.id ?? "none"} className="space-y-3">
            {gi === firstCompleted && (
              <div className="pt-4">
                <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-3">Completed recently</h2>
                <p className="text-xs text-ink-3">
                  Filled openings stay here for {RECENT_DAYS} days, then move to the Openings page.
                </p>
              </div>
            )}

            <Card className="space-y-4 p-0">
              {/* ---- headline ---- */}
              <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold tracking-tight text-ink">
                    {o ? (
                      <Link href={`/hr/openings/${o.id}`} className="hover:text-accent hover:underline">
                        {o.designation} {needed > 1 && <span className="text-ink-2">× {needed}</span>}
                      </Link>
                    ) : (
                      "Candidates without an opening"
                    )}
                  </h3>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                    {o ? (
                      <>
                        <span className="font-mono">{o.code}</span>
                        {o.project && <span>· {o.project.code}</span>}
                        <span>
                          · raised{" "}
                          {new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        </span>
                        <DueChip requiredBy={o.required_by} done={!isLive(o)} />
                      </>
                    ) : (
                      <span>Added by HR without a requirement from planning</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {o && <Badge tone={OPENING_STATUS_TONE[o.status]}>{OPENING_STATUS_LABEL[o.status]}</Badge>}
                </div>
              </header>

              {/* ---- how the hiring is going ---- */}
              {o && (
                <div className="space-y-2 px-5">
                  <HiringBar needed={needed} joined={joined} accepted={hires.length - joined} />
                  <p className="text-sm text-ink-2">
                    <span className="font-semibold text-ink">{joined}</span> joined
                    {hires.length - joined > 0 && (
                      <>
                        {" · "}
                        <span className="font-semibold text-ink">{hires.length - joined}</span> still to join
                      </>
                    )}
                    {stillToHire > 0 && (
                      <>
                        {" · "}
                        <span className="font-semibold text-ink">{stillToHire}</span> still to hire
                      </>
                    )}
                    {" of "}
                    {needed}
                  </p>
                </div>
              )}

              {/* ---- the people hired ---- */}
              {hires.length > 0 && (
                <ul className="divide-y divide-line border-y border-line">
                  {hires.map((h) => {
                    const notes = hireNotes({
                      offerAcceptedOn: offerDates.get(h.id) ?? null,
                      joinedOn: h.joined_on,
                      dateOfJoining: h.date_of_joining,
                      requiredBy: o?.required_by ?? null,
                    });
                    return (
                      <li
                        key={h.id}
                        id={`cand-${h.id}`}
                        className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3", h.joined_on ? "bg-good-soft/30" : "bg-accent-soft/20")}
                      >
                        <span className="text-sm">
                          {candidateName(h, "font-semibold")}
                          <span className="ml-2 text-ink-2">{h.designation ?? "—"}</span>
                        </span>
                        <span className="ml-auto flex flex-wrap items-center gap-1.5">
                          {notes.map((n) => (
                            <Badge key={n.text} tone={n.tone}>
                              {n.text}
                            </Badge>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* ---- the pipeline ---- */}
              {o && (
                <div className="space-y-1.5 px-5">
                  <Funnel steps={funnelFor(o.id, counts?.total ?? 0)} />
                  <p className="text-xs text-ink-2">
                    {awaiting > 0 && (
                      <span className="font-medium text-warn">
                        {awaiting} interview{awaiting === 1 ? "" : "s"} awaiting feedback
                      </span>
                    )}
                    {awaiting > 0 && (counts?.closed ?? 0) > 0 && " · "}
                    {(counts?.closed ?? 0) > 0 && `${counts?.closed} rejected in total`}
                    {awaiting === 0 && !(counts?.closed ?? 0) && (counts?.total ? "No one rejected so far" : "No candidates tagged yet")}
                  </p>
                </div>
              )}

              {/* ---- the detail, folded away ---- */}
              <details open={focusHere} className="group border-t border-line">
                <summary className="cursor-pointer list-none px-5 py-2.5 text-xs font-medium text-accent hover:bg-surface-2">
                  <span className="group-open:hidden">
                    Show candidates{g.total ? ` (${g.total.toLocaleString("en-IN")})` : ""} ▾
                  </span>
                  <span className="hidden group-open:inline">Hide candidates ▴</span>
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {rest.length === 0 && (
                    <li className="px-5 py-4 text-sm text-ink-2">No other candidates for this filter.</li>
                  )}
                  {rest.map((c) => (
                    <li
                      key={c.id}
                      id={`cand-${c.id}`}
                      className={cn("space-y-2 px-5 py-3.5", c.id === focus?.id && "bg-accent-soft/40")}
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
                  {g.rows.length < g.total && (
                    <li className="px-5 py-2.5">
                      <Link
                        href={!isHr && o ? `/hr/openings/${o.id}` : o ? `/hr?opening=${o.code}` : "/hr"}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        See all {g.total.toLocaleString("en-IN")} {isHr ? "in the candidate list" : "on the opening"} →
                      </Link>
                    </li>
                  )}
                </ul>
              </details>
            </Card>
          </div>
        );
      })}

      {focus && <ScrollToCard id={`cand-${focus.id}`} />}
    </div>
  );
}
