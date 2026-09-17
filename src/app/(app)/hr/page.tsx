import Link from "next/link";
import { after } from "next/server";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { TD, TH, TRow, Table } from "@/components/ui/Table";
import { getHrContext } from "@/lib/hr/auth";
import { getOpenOpenings, getStages } from "@/lib/hr/data";
import { fmtAgo } from "@/lib/hr/format";
import { getConnection, isExcelReady, syncIfStale } from "@/lib/hr/sync";
import { InlineStatusSelect, QuickAddForm, SyncButton } from "./HrForms";

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

  const [{ data, count }, stages, openings, conn] = await Promise.all([
    query,
    getStages(),
    getOpenOpenings(),
    getConnection(),
  ]);
  const rows = data ?? [];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const excel = isExcelReady(conn);
  const stageNames = stages.map((s) => s.name);
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
        title="Candidates"
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

      <Card className="space-y-3">
        <CardLabel>Quick add</CardLabel>
        <QuickAddForm stages={stageNames} openings={openings} defaultStatus={firstActive} />
      </Card>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, phone, ID, post" className="w-72" />
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
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">Apply</button>
        <Link href="/hr" className="px-2 py-2 text-sm text-ink-2 hover:underline">
          Reset
        </Link>
        <span className="ml-auto text-sm text-ink-2">{total.toLocaleString("en-IN")} candidates</span>
      </form>

      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-2">No candidates found.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>ID</TH>
                <TH>Date</TH>
                <TH>Name</TH>
                <TH>Designation</TH>
                <TH>Phone</TH>
                <TH>Exp.</TH>
                <TH>Current</TH>
                <TH>Expected</TH>
                <TH>Opening</TH>
                <TH>Status</TH>
                <TH> </TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <TRow key={r.id}>
                  <TD className="whitespace-nowrap font-mono text-xs text-ink-2">{r.candidate_code}</TD>
                  <TD className="whitespace-nowrap text-xs text-ink-2">{r.entry_date ?? "—"}</TD>
                  <TD>
                    <Link href={`/hr/candidates/${r.id}`} className="font-medium text-accent hover:underline">
                      {r.name}
                    </Link>
                  </TD>
                  <TD className="text-ink-2">{r.designation ?? "—"}</TD>
                  <TD className="whitespace-nowrap text-ink-2">{r.phone ?? "—"}</TD>
                  <TD className="text-ink-2">{r.experience_years ?? "—"}</TD>
                  <TD className="whitespace-nowrap text-ink-2">{r.current_salary ?? "—"}</TD>
                  <TD className="whitespace-nowrap text-ink-2">{r.expected_salary ?? "—"}</TD>
                  <TD className="whitespace-nowrap font-mono text-xs text-ink-2">{r.opening_code ?? "—"}</TD>
                  <TD>
                    <InlineStatusSelect key={r.status ?? ""} id={r.id} status={r.status} stages={stageNames} />
                  </TD>
                  <TD className="whitespace-nowrap">
                    <Link href={`/hr/status?candidate=${r.id}`} className="text-xs font-medium text-accent hover:underline">
                      Show status
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
