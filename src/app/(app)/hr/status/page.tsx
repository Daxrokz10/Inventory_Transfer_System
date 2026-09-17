import Link from "next/link";
import { after } from "next/server";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/cn";
import { getHrContext } from "@/lib/hr/auth";
import { getOpenOpenings, getStages, type Stage } from "@/lib/hr/data";
import { daysSince } from "@/lib/hr/format";
import { syncIfStale } from "@/lib/hr/sync";
import { selectAll } from "@/lib/supabase/selectAll";
import { ScrollToCard } from "./ScrollToCard";

const PER_STAGE = 40;

type Search = { candidate?: string; opening?: string; q?: string };

type Card = {
  id: string;
  candidate_code: string;
  name: string;
  designation: string | null;
  opening_code: string | null;
  status: string | null;
};

const KIND_TONE: Record<Stage["kind"], BadgeTone> = {
  active: "accent",
  hold: "warn",
  success: "good",
  closed: "danger",
};

const NO_STATUS = "(no status)";

export default async function StatusPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase } = await getHrContext("staff");
  const sp = await searchParams;
  after(() => syncIfStale());

  const q = (sp.q ?? "").trim().replace(/[,()%]/g, " ");
  const filtered = Boolean(q || sp.opening);
  // Same search/opening filters on every candidate query below.
  type Filterable = { or: (f: string) => Filterable; eq: (c: string, v: string) => Filterable };
  function applyFilters<T>(query: T): T {
    let out = query as unknown as Filterable;
    if (q) out = out.or(`name.ilike.%${q}%,candidate_code.ilike.%${q}%,phone.ilike.%${q}%`);
    if (sp.opening) out = out.eq("opening_code", sp.opening);
    return out as unknown as T;
  }

  // ---- counts per status (in the database; with filters, over the filtered set) ----
  const [stages, openings, focus] = await Promise.all([
    getStages(),
    getOpenOpenings(),
    sp.candidate
      ? supabase
          .from("hr_candidates")
          .select("id, candidate_code, name, designation, opening_code, status")
          .eq("id", sp.candidate)
          .maybeSingle()
          .then((r) => r.data as Card | null)
      : Promise.resolve(null),
  ]);

  const counts = new Map<string, number>();
  if (filtered) {
    const rows = await selectAll<{ id: string; status: string | null }>(() =>
      applyFilters(supabase.from("hr_candidates").select("id, status")).order("id"),
    );
    for (const r of rows) counts.set(r.status ?? NO_STATUS, (counts.get(r.status ?? NO_STATUS) ?? 0) + 1);
  } else {
    const { data } = await supabase.from("hr_status_counts").select("status, n");
    for (const r of data ?? []) counts.set(r.status ?? NO_STATUS, r.n);
  }

  // Columns: configured stages in order, then any status not configured yet.
  const columns: Stage[] = [...stages];
  for (const name of counts.keys()) {
    if (!columns.some((s) => s.name === name)) columns.push({ name, sort_order: 2000, kind: "active" });
  }
  const visible = columns.filter((c) => (counts.get(c.name) ?? 0) > 0 || c.sort_order < 1000);

  // ---- cards for in-process / on-hold stages ----
  const listed = visible.filter((c) => c.kind === "active" || c.kind === "hold");
  const cardLists = await Promise.all(
    listed.map(async (c) => {
      let query = supabase
        .from("hr_candidates")
        .select("id, candidate_code, name, designation, opening_code, status")
        .order("updated_at", { ascending: false })
        .limit(PER_STAGE);
      query = c.name === NO_STATUS ? query.is("status", null) : query.eq("status", c.name);
      const { data } = await applyFilters(query);
      return [c.name, (data ?? []) as Card[]] as const;
    }),
  );
  const cards = new Map<string, Card[]>(cardLists);

  // The candidate we jumped to is always shown, even outside the first 40
  // or in a final stage.
  const focusStage = focus ? (focus.status ?? NO_STATUS) : null;
  if (focus && focusStage) {
    const list = cards.get(focusStage) ?? [];
    if (!list.some((c) => c.id === focus.id)) cards.set(focusStage, [focus, ...list]);
  }

  // ---- days in stage + interview progress for the shown cards ----
  const shownIds = [...cards.values()].flat().map((c) => c.id);
  const [{ data: history }, { data: interviews }] = await Promise.all([
    shownIds.length
      ? supabase
          .from("hr_status_history")
          .select("candidate_id, to_status, changed_at")
          .in("candidate_id", shownIds)
          .order("changed_at", { ascending: false })
      : Promise.resolve({ data: [] as { candidate_id: string; to_status: string | null; changed_at: string }[] }),
    shownIds.length
      ? supabase.from("hr_interviews").select("candidate_id, state").in("candidate_id", shownIds).neq("state", "cancelled")
      : Promise.resolve({ data: [] as { candidate_id: string; state: string }[] }),
  ]);
  const enteredAt = new Map<string, string>();
  for (const h of history ?? []) if (!enteredAt.has(h.candidate_id)) enteredAt.set(h.candidate_id, h.changed_at);
  const ivs = new Map<string, { done: number; total: number }>();
  for (const i of interviews ?? []) {
    const v = ivs.get(i.candidate_id) ?? { done: 0, total: 0 };
    v.total++;
    if (i.state === "completed") v.done++;
    ivs.set(i.candidate_id, v);
  }
  const daysIn = (id: string) => {
    const at = enteredAt.get(id);
    return at ? daysSince(at) : null;
  };

  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const statusHref = (name: string) =>
    `/hr?status=${encodeURIComponent(name === NO_STATUS ? "__none" : name)}${sp.opening ? `&opening=${sp.opening}` : ""}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Status"
        subtitle={`Where every candidate is in the process · ${total.toLocaleString("en-IN")} candidates`}
        actions={
          <Link href="/hr/settings#stages" className="text-sm font-medium text-accent hover:underline">
            Order stages
          </Link>
        }
      />

      {focus && (
        <div className="rounded-lg border border-accent bg-accent-soft px-4 py-3 text-sm text-ink">
          <Link href={`/hr/candidates/${focus.id}`} className="font-semibold text-accent-strong hover:underline">
            {focus.name}
          </Link>{" "}
          ({focus.candidate_code}) is at <b>{focus.status ?? "no status"}</b>
          {daysIn(focus.id) !== null && <> for {daysIn(focus.id)} day(s)</>}
          {ivs.get(focus.id) && (
            <>
              {" "}· interviews {ivs.get(focus.id)!.done}/{ivs.get(focus.id)!.total} feedback in
            </>
          )}
          .
        </div>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3">
        {sp.candidate && <input type="hidden" name="candidate" value={sp.candidate} />}
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, phone, ID" className="w-64" />
        <Select name="opening" defaultValue={sp.opening ?? ""}>
          <option value="">All openings</option>
          {openings.map((o) => (
            <option key={o.code} value={o.code}>
              {o.code} · {o.designation}
            </option>
          ))}
        </Select>
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">Apply</button>
        <Link href="/hr/status" className="px-2 py-2 text-sm text-ink-2 hover:underline">
          Reset
        </Link>
      </form>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-6 text-sm text-ink-2">
          No candidates yet. Connect the Excel in Settings to bring them in.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {visible.map((col) => {
            const n = counts.get(col.name) ?? 0;
            const list = cards.get(col.name);
            const isFinal = col.kind === "success" || col.kind === "closed";
            return (
              <section key={col.name} className="flex w-64 shrink-0 flex-col rounded-lg border border-line bg-surface-2">
                <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                  <p className="truncate text-sm font-semibold text-ink" title={col.name}>
                    {col.name}
                  </p>
                  <Badge tone={KIND_TONE[col.kind]}>{n.toLocaleString("en-IN")}</Badge>
                </header>
                <div className="max-h-[65vh] space-y-2 overflow-y-auto p-2">
                  {(list ?? []).map((c) => {
                    const focused = c.id === focus?.id;
                    const d = daysIn(c.id);
                    const iv = ivs.get(c.id);
                    return (
                      <Link
                        key={c.id}
                        id={`cand-${c.id}`}
                        href={`/hr/candidates/${c.id}`}
                        className={cn(
                          "block rounded-md border bg-surface p-2.5 text-sm shadow-sm transition-colors hover:border-accent",
                          focused ? "border-accent ring-2 ring-accent" : "border-line",
                        )}
                      >
                        <p className="font-medium text-ink">{c.name}</p>
                        <p className="text-xs text-ink-2">{c.designation ?? "—"}</p>
                        <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
                          <span className="font-mono">{c.candidate_code}</span>
                          {c.opening_code && <span className="font-mono">{c.opening_code}</span>}
                          {d !== null && <span>{d}d here</span>}
                          {iv && (
                            <span>
                              interviews {iv.done}/{iv.total}
                            </span>
                          )}
                        </p>
                      </Link>
                    );
                  })}
                  {isFinal && !list?.length && <p className="px-1 py-2 text-xs text-ink-3">Final stage</p>}
                  {(isFinal || n > (list?.length ?? 0)) && n > 0 && (
                    <Link href={statusHref(col.name)} className="block px-1 py-1 text-xs font-medium text-accent hover:underline">
                      View all {n.toLocaleString("en-IN")} →
                    </Link>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {focus && <ScrollToCard id={`cand-${focus.id}`} />}
    </div>
  );
}
