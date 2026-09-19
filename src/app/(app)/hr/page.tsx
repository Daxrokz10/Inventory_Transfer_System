import Link from "next/link";
import { after } from "next/server";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { TD, TH, TRow, Table } from "@/components/ui/Table";
import { getHrContext } from "@/lib/hr/auth";
import { getDesignations, getOpenOpenings, getStages, joiningStages } from "@/lib/hr/data";
import { fmtAgo } from "@/lib/hr/format";
import { getConnection, isExcelReady, syncIfStale } from "@/lib/hr/sync";
import { InlineStatusSelect, QuickAddPanel, SyncButton } from "./HrForms";

const PAGE_SIZE = 50;

type Search = { q?: string; status?: string; opening?: string; page?: string };

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase } = await getHrContext("staff");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  // Pull Excel changes in the background; the page never waits on Microsoft.
  after(() => syncIfStale());

  let query = supabase
    .from("hr_candidates")
    .select(
      "id, candidate_code, entry_date, name, designation, phone, experience_years, current_salary, expected_salary, status, opening_code",
      { count: "exact" },
    )
    .order("candidate_code", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const q = (sp.q ?? "").trim().replace(/[,()%]/g, " ");
  if (q) {
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,candidate_code.ilike.%${q}%,designation.ilike.%${q}%`);
  }
  if (sp.status === "__none") query = query.is("status", null);
  else if (sp.status) query = query.eq("status", sp.status);
  if (sp.opening) query = query.eq("opening_code", sp.opening);

  const [{ data, count }, stages, openings, designations, conn] = await Promise.all([
    query,
    getStages(),
    getOpenOpenings(),
    getDesignations(),
    getConnection(),
  ]);
  const rows = data ?? [];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const excel = isExcelReady(conn);
  const stageNames = stages.map((s) => s.name);
  const joining = joiningStages(stages);
  const firstActive = stages.find((s) => s.kind === "active" && s.sort_order < 1000)?.name ?? null;

  const pageHref = (p: number) => {
    const u = new URLSearchParams();
    if (sp.q) u.set("q", sp.q);
    if (sp.status) u.set("status", sp.status);
    if (sp.opening) u.set("opening", sp.opening);
    if (p > 1) u.set("page", String(p));
    return `/hr${u.size ? `?${u}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Candidates · ${total.toLocaleString("en-IN")}`}
        subtitle={
          excel ? (
            <>
              Synced with the master Excel · last sync {fmtAgo(conn.last_synced_at)}
              {conn.last_error && <span className="text-danger"> · last error: {conn.last_error}</span>}
            </>
          ) : (
            <>
              Excel sync is off.{" "}
              <Link href="/hr/settings" className="font-medium text-accent hover:underline">
                Connect it in Settings
              </Link>
              .
            </>
          )
        }
        actions={
          <>
            {excel && conn.workbook_url && (
              <a
                href={conn.workbook_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
              >
                Open Excel ↗
              </a>
            )}
            {excel && <SyncButton />}
          </>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, phone, ID, post" className="w-64" />
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All statuses</option>
            {stages.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
            <option value="__none">No status</option>
          </Select>
          <Select name="opening" defaultValue={sp.opening ?? ""}>
            <option value="">All openings</option>
            {openings.map((o) => (
              <option key={o.code} value={o.code}>
                {o.code} · {o.designation}
              </option>
            ))}
          </Select>
          <button className="rounded-md border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
            Apply
          </button>
          {(sp.q || sp.status || sp.opening) && (
            <Link href="/hr" className="px-2 py-2 text-sm text-ink-2 hover:underline">
              Clear
            </Link>
          )}
        </form>
        <QuickAddPanel stages={stageNames} openings={openings} designations={designations} defaultStatus={firstActive} />
      </div>

      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-2">No candidates found.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>Candidate</TH>
                <TH>Designation</TH>
                <TH>Phone</TH>
                <TH className="text-right">Exp.</TH>
                <TH className="text-right">Salary now → expected</TH>
                <TH>Status</TH>
                <TH> </TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <TRow key={r.id}>
                  <TD className="align-top">
                    <Link href={`/hr/candidates/${r.id}`} className="font-medium text-accent hover:underline">
                      {r.name}
                    </Link>
                    <p className="font-mono text-[11px] text-ink-3">
                      {r.candidate_code}
                      {r.entry_date ? ` · ${r.entry_date}` : ""}
                      {r.opening_code ? ` · ${r.opening_code}` : ""}
                    </p>
                  </TD>
                  <TD className="align-top text-ink-2">{r.designation ?? "—"}</TD>
                  <TD className="whitespace-nowrap align-top text-ink-2">{r.phone ?? "—"}</TD>
                  <TD className="whitespace-nowrap align-top text-right tabular-nums text-ink-2">{r.experience_years ?? "—"}</TD>
                  <TD className="whitespace-nowrap align-top text-right tabular-nums text-ink-2">
                    {r.current_salary ?? "—"} <span className="text-ink-3">→</span> {r.expected_salary ?? "—"}
                  </TD>
                  <TD className="align-top">
                    <InlineStatusSelect key={r.status ?? ""} id={r.id} status={r.status} stages={stageNames} joining={joining} />
                  </TD>
                  <TD className="whitespace-nowrap align-top">
                    <Link href={`/hr/candidates/${r.id}`} className="text-xs font-medium text-accent hover:underline">
                      Open →
                    </Link>
                  </TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-accent hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-2">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="text-accent hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
