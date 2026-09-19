import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card, CardLabel } from "@/components/ui/Card";
import { getHrContext } from "@/lib/hr/auth";
import { OPENING_STATUS_LABEL, PRIORITY_LABEL, getStages, joiningStages } from "@/lib/hr/data";
import { OPENING_STATUS_TONE as STATUS_TONE, joiningNote, statusTone } from "@/lib/hr/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { OpeningStatusForm, TagCandidateForm } from "../../HrForms";
import { Timeline, TimelineStrip } from "../../Timeline";
import { buildTimelines, type CandidateRow } from "@/lib/hr/progress";

export default async function OpeningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, access, user } = await getHrContext("openings");
  const admin = createAdminClient();

  // Interviewers have no read policy on openings; they only look, so they read
  // through the service role. HR and planning read under their own RLS.
  const { data: o } = await (access.hrStaff || access.planning ? supabase : admin)
    .from("hr_openings")
    .select("id, code, designation, headcount, required_by, experience, salary_range, description, priority, status, acknowledged_at, raised_by, created_at, project:project_id(code, name)")
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();
  const opening = o as unknown as typeof o & { project: { code: string; name: string } | null };
  if (!access.hrStaff && !access.interviewer && opening.raised_by !== user.id) notFound();
  // HR, and the planning user who raised it, follow the hiring in full.
  const canSeeProgress = access.hrStaff || opening.raised_by === user.id;
  // Planning can't read candidates under RLS; for their own opening they read
  // through the service role, and only the rows tagged to it.
  const progressClient = access.hrStaff ? supabase : (admin as unknown as typeof supabase);
  // First time HR opens it, it stops showing as "New".
  if (access.hrStaff && !opening.acknowledged_at) {
    await admin.from("hr_openings").update({ acknowledged_at: new Date().toISOString() }).eq("id", id);
  }

  const [stages, { data: counts }, { data: raiser }, candidates] = await Promise.all([
    getStages(),
    admin.from("hr_opening_status_counts").select("status, n").eq("opening_id", id),
    opening.raised_by
      ? admin.from("profiles").select("full_name").eq("id", opening.raised_by).maybeSingle()
      : Promise.resolve({ data: null }),
    canSeeProgress
      ? progressClient
          .from("hr_candidates")
          .select("id, candidate_code, name, designation, status, entry_date, created_at, opening_id, joined_on")
          .eq("opening_id", id)
          .order("updated_at", { ascending: false })
          .limit(200)
          .then((r) => (r.data ?? []) as CandidateRow[])
      : Promise.resolve([] as CandidateRow[]),
  ]);

  const order = new Map(stages.map((s, i) => [s.name, i]));
  const kindOf = new Map(stages.map((s) => [s.name, s.kind]));
  const byStage = [...(counts ?? [])].sort((a, b) => (order.get(a.status ?? "") ?? 999) - (order.get(b.status ?? "") ?? 999));
  const { joined: joinedStage } = joiningStages(stages);
  const joinedN = byStage.filter((c) => c.status === joinedStage).reduce((s, c) => s + c.n, 0);
  const acceptedN = byStage
    .filter((c) => c.status && kindOf.get(c.status) === "success" && c.status !== joinedStage)
    .reduce((s, c) => s + c.n, 0);

  // Whoever actually joined against this requirement. Their journey belongs
  // here, in full — the status board keeps only the one-line version.
  const joiners = candidates.filter((c) => c.joined_on).sort((a, b) => (a.joined_on ?? "").localeCompare(b.joined_on ?? ""));
  const stillNeeded = Math.max(0, Math.max(1, opening.headcount) - joinedN);
  // Every tagged candidate's journey lives here — this is the page that tells
  // the whole story of the requirement.
  const timelines = await buildTimelines(
    candidates,
    [{ ...opening, raised_by: opening.raised_by }],
    access.hrStaff ? undefined : progressClient,
  );

  const facts: [string, string | null][] = [
    ["Site", opening.project ? `${opening.project.code} — ${opening.project.name}` : null],
    ["People needed", String(opening.headcount)],
    ["Needed by", opening.required_by ? new Date(opening.required_by).toLocaleDateString("en-IN") : null],
    ["Experience", opening.experience],
    ["Salary range", opening.salary_range],
    ["Priority", PRIORITY_LABEL[opening.priority]],
    ["Raised by", raiser?.full_name ?? null],
    ["Raised on", new Date(opening.created_at).toLocaleDateString("en-IN")],
  ];

  return (
    <div className="space-y-5">
      <Link href="/hr/openings" className="text-sm text-ink-2 hover:underline">
        ← Openings
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-ink-3">{opening.code}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{opening.designation}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-ink-2">
            <Badge tone={STATUS_TONE[opening.status]}>{OPENING_STATUS_LABEL[opening.status]}</Badge>
            {joinedN}/{opening.headcount} joined
            {acceptedN > 0 && ` · ${acceptedN} offer${acceptedN === 1 ? "" : "s"} accepted, not yet joined`}
            {joinedN > 0 && stillNeeded > 0 && ` · ${stillNeeded} still to join`}
          </p>
        </div>
        {access.hrStaff && <OpeningStatusForm id={opening.id} status={opening.status} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="space-y-4">
          <CardLabel>Details</CardLabel>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-ink-3">{k}</dt>
                <dd className="text-ink">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {opening.description && <p className="whitespace-pre-wrap text-sm text-ink">{opening.description}</p>}
        </Card>

        <Card className="space-y-3">
          <CardLabel>Candidates by stage</CardLabel>
          {byStage.length === 0 ? (
            <p className="text-sm text-ink-2">No candidates tagged yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {byStage.map((c) => (
                <li key={c.status ?? "none"} className="flex items-center justify-between">
                  <span className="text-ink">{c.status ?? "No status"}</span>
                  <span className="tabular-nums text-ink-2">{c.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {access.hrStaff && (
          <Card className="space-y-3">
            <CardLabel>Tag a candidate</CardLabel>
            <TagCandidateForm openingCode={opening.code} />
            <p className="text-xs text-ink-3">
              Or type <span className="font-mono">{opening.code}</span> in the Opening column of the Excel.
            </p>
          </Card>
        )}
      </div>

      {canSeeProgress &&
        joiners.map((j) => {
          const note = joiningNote(j.joined_on ?? null, opening.required_by);
          return (
            <Card key={j.id} className="p-0">
              <details open className="group">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    <span className="font-semibold text-ink">{j.name} joined</span>
                    <span className="ml-2 text-ink-2">the whole journey, from requirement to joining</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {note && <Badge tone={note.tone}>{note.text}</Badge>}
                    <span className="text-xs text-accent group-open:hidden">show</span>
                    <span className="hidden text-xs text-accent group-open:inline">hide</span>
                  </span>
                </summary>
                <div className="border-t border-line px-5 py-4">
                  <Timeline events={timelines.get(j.id) ?? []} />
                </div>
              </details>
            </Card>
          );
        })}

      {canSeeProgress && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <CardLabel>Tagged candidates · {candidates.length}</CardLabel>
            <Link href={`/hr/status?opening=${opening.code}`} className="text-xs font-medium text-accent hover:underline">
              See on status board →
            </Link>
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-ink-2">None yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {candidates.map((c) => (
                <li key={c.id} className="space-y-2 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <Link href={`/hr/candidates/${c.id}`} className="font-medium text-accent hover:underline">
                        {c.name}
                      </Link>
                      <span className="ml-2 text-ink-2">{c.designation ?? ""}</span>
                      <span className="ml-2 font-mono text-[11px] text-ink-3">{c.candidate_code}</span>
                    </span>
                    {c.status && <Badge tone={statusTone(c.status)}>{c.status}</Badge>}
                  </div>
                  <details className="group">
                    <summary className="cursor-pointer list-none">
                      <TimelineStrip events={timelines.get(c.id) ?? []} />
                      <span className="mt-1 inline-block text-xs text-accent group-open:hidden">show full timeline</span>
                      <span className="mt-1 hidden text-xs text-accent group-open:inline">hide</span>
                    </summary>
                    <div className="mt-3 border-l border-line pl-1">
                      <Timeline events={timelines.get(c.id) ?? []} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
