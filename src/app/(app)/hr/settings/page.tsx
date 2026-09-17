import { Card, CardLabel } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getHrContext } from "@/lib/hr/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fmtAgo } from "@/lib/hr/format";
import { isMsConfigured } from "@/lib/hr/graph";
import { getConnection } from "@/lib/hr/sync";
import { getStages } from "@/lib/hr/data";
import { colLetter } from "@/lib/hr/graph";
import { CANDIDATE_FIELDS, FIELD_LABELS, type CandidateField } from "@/lib/hr/sheet";
import { AddStageForm, DisconnectButton, StagesForm, SyncButton, WorkbookForm } from "../HrForms";

type Search = { error?: string; connected?: string };

export default async function HrSettingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase } = await getHrContext("staff");
  const sp = await searchParams;

  const configured = isMsConfigured();
  let conn = null;
  let setupError: string | null = null;
  try {
    conn = await getConnection();
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }
  if (!conn && !setupError) setupError = "The HR tables are missing. Run migrations 0034 and 0035 in Supabase.";

  const [stages, { data: counts }, { data: mapRow }] = await Promise.all([
    getStages(),
    supabase.from("hr_status_counts").select("status, n"),
    createAdminClient().from("hr_ms_connection").select("column_map").eq("id", 1).maybeSingle(),
  ]);
  const columnMap = (mapRow?.column_map ?? null) as {
    headerRow: number;
    headers: { col: number; text: string; field: CandidateField | null }[];
  } | null;
  const matched = new Set(columnMap?.headers.map((h) => h.field).filter(Boolean));
  const missing = CANDIDATE_FIELDS.filter((f) => !matched.has(f));
  const countOf = new Map((counts ?? []).map((c) => [c.status, c.n]));

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="HR settings" subtitle="Connect the master Excel so candidates stay in sync both ways." />

      {sp.error && <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">{sp.error}</p>}
      {sp.connected && (
        <p className="rounded-md bg-good-soft px-4 py-3 text-sm text-good">Connected as {sp.connected}.</p>
      )}
      {setupError && <p className="rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">{setupError}</p>}

      <Card className="space-y-3">
        <CardLabel>1 · Microsoft 365 account</CardLabel>
        {!configured ? (
          <p className="text-sm text-ink-2">
            The Microsoft app isn&apos;t set up yet. Add <code>MS_TENANT_ID</code>, <code>MS_CLIENT_ID</code> and{" "}
            <code>MS_CLIENT_SECRET</code> to the environment, then reload this page.
          </p>
        ) : conn?.refresh_token ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink">
              Connected as <span className="font-medium">{conn.account_email}</span>
            </p>
            <div className="flex items-center gap-2">
              <a href="/api/hr/oauth/start" className="text-sm font-medium text-accent hover:underline">
                Reconnect
              </a>
              <DisconnectButton />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-2">
              Sign in with the Microsoft account that can edit the master Excel. The app reads and writes the sheet
              as this account and uses it to show resumes.
            </p>
            <a
              href="/api/hr/oauth/start"
              className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
            >
              Connect Microsoft account
            </a>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <CardLabel>2 · Master Excel</CardLabel>
        {conn?.refresh_token ? (
          <WorkbookForm url={conn.workbook_url} sheet={conn.sheet_name} />
        ) : (
          <p className="text-sm text-ink-2">Connect the Microsoft account first.</p>
        )}
        <p className="text-xs text-ink-3">
          Columns are matched by their headings (Name, Designation, Ph number, Salary current, Salary expected, Years
          of experience, Industrial experience, HR Remarks, Reason for job change, Status). The app adds{" "}
          <b>Candidate ID</b>, <b>Resume</b> and <b>Opening</b> columns if they&apos;re missing. Don&apos;t edit or
          delete the IDs: they link each row to its interviews. The first sync of ~6,000 rows takes about a minute.
        </p>
      </Card>

      {conn?.drive_id && (
        <Card className="space-y-3">
          <CardLabel>3 · Sync</CardLabel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="text-ink">
                Sheet <span className="font-medium">{conn.sheet_name}</span> · last synced {fmtAgo(conn.last_synced_at)}
              </p>
              {conn.last_error && <p className="text-danger">Last error: {conn.last_error}</p>}
              <p className="text-xs text-ink-3">
                Syncs in the background when HR pages are opened (at most every 2 minutes) and once a day.
              </p>
            </div>
            <SyncButton />
          </div>
        </Card>
      )}

      {columnMap && (
        <Card className="space-y-3">
          <CardLabel>Column matching (header row {columnMap.headerRow})</CardLabel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-3">
                  <th className="py-1.5 pr-3">Column</th>
                  <th className="py-1.5 pr-3">Heading in the Excel</th>
                  <th className="py-1.5">Used as</th>
                </tr>
              </thead>
              <tbody>
                {columnMap.headers.map((h) => (
                  <tr key={h.col} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-mono text-xs text-ink-2">{colLetter(h.col)}</td>
                    <td className="py-1.5 pr-3 text-ink">{h.text}</td>
                    <td className="py-1.5">
                      {h.field ? (
                        <span className="text-good">{FIELD_LABELS[h.field]}</span>
                      ) : (
                        <span className="text-ink-3">not used</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <p className="text-xs text-warn">
              No column found for: {missing.map((f) => FIELD_LABELS[f]).join(", ")}. Tell Daksh the heading used for
              these so it can be matched.
            </p>
          )}
        </Card>
      )}

      <Card id="stages" className="space-y-3">
        <CardLabel>4 · Stages (status page order)</CardLabel>
        <p className="text-xs text-ink-3">
          Every Status value found in the Excel is listed here. Number them in process order and mark which ones are
          final. New values typed in the Excel appear as &quot;unsorted&quot; until you place them.
        </p>
        <AddStageForm />
        {stages.length === 0 ? (
          <p className="text-sm text-ink-2">No statuses yet: they appear after the first sync.</p>
        ) : (
          <StagesForm stages={stages.map((s) => ({ ...s, count: countOf.get(s.name) ?? 0 }))} />
        )}
      </Card>
    </div>
  );
}
