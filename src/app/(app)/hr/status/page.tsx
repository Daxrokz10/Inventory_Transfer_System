import Link from "next/link";
import { after } from "next/server";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/cn";
import { getHrContext } from "@/lib/hr/auth";
import { OPENING_STATUS_LABEL, getStages } from "@/lib/hr/data";
import { OPENING_STATUS_TONE, joiningNote, statusTone } from "@/lib/hr/format";
import { buildTimelines, type CandidateRow } from "@/lib/hr/progress";
import { syncIfStale } from "@/lib/hr/sync";
import { TimelineStrip } from "../Timeline";
import { ScrollToCard } from "./ScrollToCard";

/* Status = one section per opening, each listing its candidates with the whole
   journey on one line (registered → telephonic → rounds → offer / rejected).
   Candidates HR added without an opening get a section of their own. */

const PER_GROUP = 25;

type Search = { candidate?: string; opening?: string; q?: string; show?: string };

const CANDIDATE_COLUMNS = "id, candidate_code, name, designation, status, entry_date, created_at, opening_id, joined_on";

type OpeningRow = {
  id: string;
  code: string;
  designation: string;
  headcount: number;
  status: string;
  required_by: string | null;
  created_at: string;
  raised_by: string | null;
  project: { code: string; name: string } | null;
};

export default async function StatusPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase } = await getHrContext("staff");
  const sp = await searchParams;
  after(() => syncIfStale());

  const q = (sp.q ?? "").trim().replace(/[,()%]/g, " ");
  // Everyone by default, rejected candidates included; the filter narrows it.
  const show = sp.show ?? "all";

  const [stages, { data: openingRows }, focus] = await Promise.all([
    getStages(),
    supabase
      .from("hr_openings")
      .select("id, code, designation, headcount, status, required_by, created_at, raised_by, project:project_id(code, name)")
      .order("created_at", { ascending: false })
      .limit(100),
    sp.candidate
      ? supabase
          .from("hr_candidates")
          .select(CANDIDATE_COLUMNS)
          .eq("id", sp.candidate)
          .maybeSingle()
          .then((r) => r.data as CandidateRow | null)
      : Promise.resolve(null),
  ]);

  const allOpenings = (openingRows ?? []) as unknown as OpeningRow[];
  // The board is about hiring still under way: filled and cancelled openings
  // live on the Openings page, with their full timelines. Picking one in the
  // filter still shows it.
  const openings = allOpenings.filter((o) =>
    sp.opening ? o.code === sp.opening : o.status === "open" || o.status === "in_progress",
  );
  const finishedStages = stages.filter((s) => s.kind === "success" || s.kind === "closed").map((s) => s.name);
  const closedStages = stages.filter((s) => s.kind === "closed").map((s) => s.name);
  const inList = (names: string[]) => `(${names.map((n) => `"${n}"`).join(",")})`;

  const fetchGroup = async (openingId: string | null) => {
    let query = supabase
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

  const groups: { opening: OpeningRow | null; rows: CandidateRow[]; total: number }[] = [];
  for (const o of openings) groups.push({ opening: o, ...(await fetchGroup(o.id)) });
  if (!sp.opening) {
    const loose = await fetchGroup(null);
    if (loose.total > 0) groups.push({ opening: null, ...loose });
  }

  // The candidate jumped to from "Show status" is always shown.
  if (focus) {
    const g = groups.find((x) => (x.opening?.id ?? null) === focus.opening_id);
    if (g && !g.rows.some((r) => r.id === focus.id)) g.rows.unshift(focus);
    else if (!g) groups.unshift({ opening: null, rows: [focus], total: 1 });
  }

  // Whoever joined against an opening is always shown, in full, whatever the
  // filter says — that is the row the opening was raised for.
  const openingIds = openings.map((o) => o.id);
  const { data: joinedRows } = openingIds.length
    ? await supabase.from("hr_candidates").select(CANDIDATE_COLUMNS).in("opening_id", openingIds).not("joined_on", "is", null)
    : { data: [] as CandidateRow[] };
  const joinedBy = new Map<string, CandidateRow>();
  for (const r of (joinedRows ?? []) as CandidateRow[]) if (r.opening_id) joinedBy.set(r.opening_id, r);

  const timelines = await buildTimelines(
    [...groups.flatMap((g) => g.rows), ...joinedBy.values()],
    allOpenings,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Status"
        subtitle="Openings still being hired for, and how far each candidate has got."
        actions={
          <Link href="/hr/settings#stages" className="text-sm font-medium text-accent hover:underline">
            Order stages
          </Link>
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

      {groups.map((g) => {
        const joined = g.opening ? joinedBy.get(g.opening.id) : undefined;
        const note = joined ? joiningNote(joined.joined_on ?? null, g.opening?.required_by ?? null) : null;
        const rest = g.rows.filter((c) => c.id !== joined?.id);
        return (
        <Card key={g.opening?.id ?? "none"} className="p-0">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            {g.opening ? (
              <div>
                <Link href={`/hr/openings/${g.opening.id}`} className="font-semibold text-accent hover:underline">
                  {g.opening.code} · {g.opening.designation}
                </Link>
                <p className="text-xs text-ink-2">
                  {g.opening.project ? `${g.opening.project.code} · ` : ""}
                  {g.opening.headcount} needed · raised{" "}
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

          {joined && (
            <section id={`cand-${joined.id}`} className="border-b border-line bg-good-soft/40 px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  <Link href={`/hr/candidates/${joined.id}`} className="font-semibold text-accent hover:underline">
                    {joined.name}
                  </Link>
                  <span className="ml-2 text-ink-2">{joined.designation ?? "—"}</span>
                  <span className="ml-2 font-mono text-[11px] text-ink-3">{joined.candidate_code}</span>
                </p>
                {note && <Badge tone={note.tone}>{note.text}</Badge>}
              </div>
              <p className="mt-1 mb-2 text-xs text-ink-2">
                Hired for this opening ·{" "}
                {g.opening && (
                  <Link href={`/hr/openings/${g.opening.id}`} className="text-accent hover:underline">
                    full timeline on the opening →
                  </Link>
                )}
              </p>
              <TimelineStrip events={timelines.get(joined.id) ?? []} />
            </section>
          )}

          <ul className="divide-y divide-line">
            {rest.length === 0 && !joined && (
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
                    <Link href={`/hr/candidates/${c.id}`} className="font-medium text-accent hover:underline">
                      {c.name}
                    </Link>
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
                href={g.opening ? `/hr?opening=${g.opening.code}` : "/hr"}
                className="text-xs font-medium text-accent hover:underline"
              >
                See all {g.total.toLocaleString("en-IN")} in the candidate list →
              </Link>
            </div>
          )}
        </Card>
        );
      })}

      {focus && <ScrollToCard id={`cand-${focus.id}`} />}
    </div>
  );
}
