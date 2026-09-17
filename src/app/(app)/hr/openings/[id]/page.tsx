import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card, CardLabel } from "@/components/ui/Card";
import { getHrContext } from "@/lib/hr/auth";
import { OPENING_STATUS_LABEL, PRIORITY_LABEL, getStages } from "@/lib/hr/data";
import { OPENING_STATUS_TONE as STATUS_TONE, statusTone } from "@/lib/hr/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { OpeningStatusForm, TagCandidateForm } from "../../HrForms";

export default async function OpeningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, access, user } = await getHrContext("planning");

  const { data: o } = await supabase
    .from("hr_openings")
    .select("id, code, designation, headcount, required_by, experience, salary_range, description, priority, status, acknowledged_at, raised_by, created_at, project:project_id(code, name)")
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();
  const opening = o as unknown as typeof o & { project: { code: string; name: string } | null };
  if (!access.hrStaff && opening.raised_by !== user.id) notFound();

  const admin = createAdminClient();
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
    access.hrStaff
      ? supabase
          .from("hr_candidates")
          .select("id, candidate_code, name, designation, status")
          .eq("opening_id", id)
          .order("updated_at", { ascending: false })
          .limit(500)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);

  const order = new Map(stages.map((s, i) => [s.name, i]));
  const kindOf = new Map(stages.map((s) => [s.name, s.kind]));
  const byStage = [...(counts ?? [])].sort((a, b) => (order.get(a.status ?? "") ?? 999) - (order.get(b.status ?? "") ?? 999));
  const filled = byStage.filter((c) => c.status && kindOf.get(c.status) === "success").reduce((s, c) => s + c.n, 0);

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
            {filled}/{opening.headcount} filled
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

      {access.hrStaff && (
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
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/hr/candidates/${c.id}`} className="font-medium text-accent hover:underline">
                    {c.name}
                  </Link>
                  <span className="flex-1 text-ink-2">{c.designation ?? ""}</span>
                  {c.status && <Badge tone={statusTone(c.status)}>{c.status}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
