import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/selectAll";
import { createRequire } from "module";
import { colLetter, downloadFile, isMsConfigured, readRange, usedRangeAddress, writeBlock } from "./graph";
import {
  CANDIDATE_FIELDS,
  FIELD_LABELS,
  asUrl,
  cellText,
  codeNumber,
  detectLayout,
  formatCode,
  hyperlinkFormula,
  hyperlinkFormulaTarget,
  parseAddress,
  rowHash,
  rowToValues,
  sameCell,
  type CandidateField,
  type CandidateValues,
  type SheetLayout,
} from "./sheet";

/* Two-way sync between the HR master Excel (6,000+ rows) and hr_candidates.

   READ  (sync): the sheet is read in 1,000-row blocks. Each row is hashed and
         only rows whose hash changed are written to the database. The only
         thing a sync ever WRITES to the Excel is a Candidate ID into rows that
         don't have one yet (plus missing column headers, once).

   WRITE (app edit): only the changed cells of that one candidate are written,
         after checking those cells still hold what the app last synced — if
         someone edited them in the Excel meanwhile, the write is refused
         rather than overwriting their edit. */

export type Connection = {
  refresh_token: string | null;
  account_email: string | null;
  workbook_url: string | null;
  drive_id: string | null;
  item_id: string | null;
  sheet_name: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  sync_started_at: string | null;
};

export async function getConnection(): Promise<Connection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("hr_ms_connection")
    .select("refresh_token, account_email, workbook_url, drive_id, item_id, sheet_name, last_synced_at, last_error, sync_started_at")
    .eq("id", 1)
    .maybeSingle();
  return (data as Connection | null) ?? null;
}

type Ready = Connection & { drive_id: string; item_id: string; sheet_name: string };

export function isExcelReady(c: Connection | null): c is Ready {
  return Boolean(isMsConfigured() && c?.refresh_token && c.drive_id && c.item_id && c.sheet_name);
}

export class ExcelConflictError extends Error {}

const require = createRequire(import.meta.url);
type XlsxCell = { v?: unknown; w?: string; f?: string; l?: { Target?: string } };
type XlsxLib = {
  read: (data: ArrayBuffer, opts: Record<string, unknown>) => { Sheets: Record<string, Record<string, XlsxCell>> };
  utils: { encode_cell: (c: { r: number; c: number }) => string; decode_range: (r: string) => { e: { r: number } } };
};

const READ_BLOCK = 1000;
const LOCK_MINUTES = 5;

/* ---------------- layout ---------------- */

type Sheet = { conn: Ready; layout: SheetLayout; firstCol: number };

/** Extent + header row, adding the Candidate ID / Resume / Opening headers
    when missing. Two or three small Graph calls. */
async function loadSheet(conn: Ready): Promise<Sheet> {
  const address = await usedRangeAddress(conn.drive_id, conn.item_id, conn.sheet_name);
  if (!address) throw new Error("The sheet looks empty.");
  const ext = parseAddress(address);

  const topLast = Math.min(ext.lastRow, ext.firstRow + 9);
  const top = await readRange(
    conn.drive_id,
    conn.item_id,
    conn.sheet_name,
    `${colLetter(ext.firstCol)}${ext.firstRow}:${colLetter(ext.lastCol)}${topLast}`,
  );
  const layout = detectLayout(
    { rowIndex: ext.firstRow - 1, columnIndex: ext.firstCol, values: top },
    { lastRow: ext.lastRow, lastCol: ext.lastCol },
  );

  const missing = (["candidate_code", "resume_url", "opening_code"] as const).filter((f) => layout.cols[f] === undefined);
  if (missing.length) {
    await writeBlock(conn.drive_id, conn.item_id, conn.sheet_name, layout.headerRow, layout.lastCol + 1, [
      missing.map((f) => FIELD_LABELS[f]),
    ]);
    missing.forEach((f, i) => (layout.cols[f] = layout.lastCol + 1 + i));
    layout.lastCol += missing.length;
  }
  return { conn, layout, firstCol: ext.firstCol };
}

type SheetRow = { row: number; values: CandidateValues };

async function readAllRows({ conn, layout, firstCol }: Sheet): Promise<SheetRow[]> {
  const out: SheetRow[] = [];
  const firstData = layout.headerRow + 1;
  for (let start = firstData; start <= layout.lastRow; start += READ_BLOCK) {
    const end = Math.min(layout.lastRow, start + READ_BLOCK - 1);
    const values = await readRange(
      conn.drive_id,
      conn.item_id,
      conn.sheet_name,
      `${colLetter(firstCol)}${start}:${colLetter(layout.lastCol)}${end}`,
    );
    values.forEach((cells, i) => {
      const v = rowToValues(cells, layout, firstCol);
      const hasData = CANDIDATE_FIELDS.some((f) => f !== "candidate_code" && v[f]);
      if (hasData) out.push({ row: start + i, values: v });
    });
  }
  return out;
}

/** Just the Candidate ID column: code → sheet row. */
async function readIdColumn({ conn, layout }: Sheet): Promise<Map<string, number>> {
  const col = colLetter(layout.cols.candidate_code!);
  const map = new Map<string, number>();
  const firstData = layout.headerRow + 1;
  for (let start = firstData; start <= layout.lastRow; start += READ_BLOCK * 5) {
    const end = Math.min(layout.lastRow, start + READ_BLOCK * 5 - 1);
    const values = await readRange(conn.drive_id, conn.item_id, conn.sheet_name, `${col}${start}:${col}${end}`);
    values.forEach((cells, i) => {
      const code = cellText(cells[0])?.toUpperCase();
      if (code && !map.has(code)) map.set(code, start + i);
    });
  }
  return map;
}

/** Resume links behind the Resume cells (HR's cells show a file name and
    link to OneDrive). Read from the saved .xlsx, which may lag the live sheet
    by a few seconds, so each link carries the Name on its row and is only
    used when that still matches the live row. */
async function readResumeLinks({ conn, layout }: Sheet): Promise<Map<number, { name: string | null; url: string | null }>> {
  const out = new Map<number, { name: string | null; url: string | null }>();
  const resumeCol = layout.cols.resume_url;
  const nameCol = layout.cols.name;
  if (resumeCol === undefined || nameCol === undefined) return out;

  const XLSX = require("xlsx") as XlsxLib;
  const wb = XLSX.read(await downloadFile(conn.drive_id, conn.item_id), { type: "array", cellFormula: true, sheetStubs: false });
  const ws = wb.Sheets[conn.sheet_name];
  if (!ws?.["!ref"]) return out;
  const lastRow = XLSX.utils.decode_range(ws["!ref"] as unknown as string).e.r + 1;

  for (let row = layout.headerRow + 1; row <= lastRow; row++) {
    const cell = ws[XLSX.utils.encode_cell({ r: row - 1, c: resumeCol })];
    if (!cell) continue;
    const nameCell = ws[XLSX.utils.encode_cell({ r: row - 1, c: nameCol })];
    const url = cell.l?.Target ?? hyperlinkFormulaTarget(cell.f) ?? asUrl(cell.w ?? String(cell.v ?? ""));
    out.set(row, { name: cellText(nameCell?.w ?? nameCell?.v), url: asUrl(url) });
  }
  return out;
}

async function saveColumnMap(layout: SheetLayout) {
  const admin = createAdminClient();
  await admin
    .from("hr_ms_connection")
    .update({ column_map: { headerRow: layout.headerRow, headers: layout.headers } })
    .eq("id", 1);
}

/* ---------------- sync (Excel → app) ---------------- */

async function acquireLock(): Promise<boolean> {
  const admin = createAdminClient();
  const stale = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const { data } = await admin
    .from("hr_ms_connection")
    .update({ sync_started_at: new Date().toISOString() })
    .eq("id", 1)
    .or(`sync_started_at.is.null,sync_started_at.lt."${stale}"`)
    .select("id");
  return Boolean(data?.length);
}

async function releaseLock(error: string | null) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin
    .from("hr_ms_connection")
    .update(
      error
        ? { sync_started_at: null, last_error: error, updated_at: now }
        : { sync_started_at: null, last_error: null, last_synced_at: now, updated_at: now },
    )
    .eq("id", 1);
}

export type SyncResult = { rows: number; changed: number; idsAssigned: number; pushed: number; skipped?: boolean };

type DbCandidate = CandidateValues & {
  id: string;
  candidate_code: string;
  excel_row: number | null;
  synced_at: string | null;
  sheet_hash: string | null;
};

export async function syncFromExcel(): Promise<SyncResult> {
  const conn = await getConnection();
  if (!isExcelReady(conn)) throw new Error("Excel is not connected. Set it up in HR → Settings.");
  if (!(await acquireLock())) return { rows: 0, changed: 0, idsAssigned: 0, pushed: 0, skipped: true };

  try {
    const admin = createAdminClient();
    const sheet = await loadSheet(conn);
    const { layout } = sheet;
    await saveColumnMap(layout);
    const [rows, links] = await Promise.all([readAllRows(sheet), readResumeLinks(sheet)]);

    const existing = await selectAll<DbCandidate>(() =>
      admin
        .from("hr_candidates")
        .select(
          "id, excel_row, synced_at, sheet_hash, entry_date, name, designation, phone, current_salary, expected_salary, experience_years, industry_experience, hr_remarks, job_change_reason, status, resume_url, opening_code, candidate_code",
        )
        // Paging needs a unique order: bulk upserts share one created_at.
        .order("id"),
    );
    const byCode = new Map(existing.map((e) => [e.candidate_code.toUpperCase(), e]));

    // ---- resume cells: the cell text is a file name; use the link behind it ----
    if (layout.cols.resume_url !== undefined) {
      for (const r of rows) {
        const link = links.get(r.row);
        const text = r.values.resume_url;
        if (link && sameCell(link.name, r.values.name)) {
          r.values.resume_url = link.url;
        } else {
          // Saved copy not caught up with this row yet: keep what we had.
          const prior = r.values.candidate_code ? byCode.get(r.values.candidate_code.toUpperCase()) : undefined;
          r.values.resume_url = asUrl(text) ?? asUrl(prior?.resume_url) ?? null;
        }
      }
    }

    // ---- IDs for rows without one (or duplicating an earlier row's) ----
    let next =
      Math.max(0, ...existing.map((e) => codeNumber(e.candidate_code)), ...rows.map((r) => codeNumber(r.values.candidate_code))) + 1;
    const seen = new Set<string>();
    const idWrites = new Map<number, string>();
    for (const r of rows) {
      const code = r.values.candidate_code?.toUpperCase() ?? null;
      // Rows without a name aren't candidates: no ID, not imported.
      if (!r.values.name) {
        if (code) seen.add(code);
        continue;
      }
      if (!code || seen.has(code)) {
        const fresh = formatCode(next++);
        r.values.candidate_code = fresh;
        idWrites.set(r.row, fresh);
        seen.add(fresh);
      } else {
        r.values.candidate_code = code;
        seen.add(code);
      }
    }
    if (idWrites.size) {
      const sorted = [...idWrites.keys()].sort((a, b) => a - b);
      // One PATCH per run of nearby rows; untouched cells in a run stay null.
      let runStart = sorted[0];
      let prev = sorted[0];
      const flush = async (from: number, to: number) => {
        const block: (string | null)[][] = [];
        for (let row = from; row <= to; row++) block.push([idWrites.get(row) ?? null]);
        await writeBlock(conn.drive_id, conn.item_id, conn.sheet_name, from, layout.cols.candidate_code!, block);
      };
      for (const row of sorted.slice(1)) {
        if (row - prev > 50 || row - runStart >= 2000) {
          await flush(runStart, prev);
          runStart = row;
        }
        prev = row;
      }
      await flush(runStart, prev);
    }

    // ---- openings by code ----
    const { data: openings } = await admin.from("hr_openings").select("id, code");
    const openingId = new Map((openings ?? []).map((o) => [o.code.toUpperCase(), o.id]));

    // ---- upsert only rows that changed ----
    const now = new Date().toISOString();
    const changed = rows.filter((r) => {
      if (!r.values.name) return false;
      const prior = byCode.get(r.values.candidate_code!);
      return !prior || prior.sheet_hash !== rowHash(r.values) || prior.excel_row !== r.row;
    });

    const history: { candidate_id: string; from_status: string | null; to_status: string | null; source: "excel" }[] = [];
    for (let i = 0; i < changed.length; i += 500) {
      const batch = changed.slice(i, i + 500).map((r) => {
        const rec: Record<string, string | number | null> = {
          candidate_code: r.values.candidate_code,
          excel_row: r.row,
          sheet_hash: rowHash(r.values),
          synced_at: now,
          updated_at: now,
        };
        for (const f of CANDIDATE_FIELDS) {
          if (f !== "candidate_code" && layout.cols[f] !== undefined) rec[f] = r.values[f];
        }
        if (layout.cols.opening_code !== undefined) {
          rec.opening_id = r.values.opening_code ? (openingId.get(r.values.opening_code.toUpperCase()) ?? null) : null;
        }
        return rec;
      });
      const { data, error } = await admin
        .from("hr_candidates")
        .upsert(batch, { onConflict: "candidate_code" })
        .select("id, candidate_code, status");
      if (error) throw new Error(error.message);
      for (const d of data ?? []) {
        const prior = byCode.get(d.candidate_code.toUpperCase());
        if (prior && !sameCell(prior.status, d.status)) {
          history.push({ candidate_id: d.id, from_status: prior.status, to_status: d.status, source: "excel" });
        }
      }
    }
    for (let i = 0; i < history.length; i += 500) {
      await admin.from("hr_status_history").insert(history.slice(i, i + 500));
    }

    // ---- rows deleted from the sheet keep their data, lose the row pointer ----
    const gone = existing.filter((e) => e.excel_row !== null && !seen.has(e.candidate_code.toUpperCase())).map((e) => e.id);
    for (let i = 0; i < gone.length; i += 500) {
      await admin.from("hr_candidates").update({ excel_row: null }).in("id", gone.slice(i, i + 500));
    }

    // ---- app-only candidates that never reached the sheet ----
    const appOnly = existing.filter((e) => e.synced_at === null && !seen.has(e.candidate_code.toUpperCase()));
    let appendAt = layout.lastRow + 1;
    for (const cand of appOnly) {
      await writeRow(sheet, appendAt, cand);
      await admin
        .from("hr_candidates")
        .update({ excel_row: appendAt, synced_at: now, sheet_hash: rowHash(cand) })
        .eq("id", cand.id);
      appendAt++;
    }

    // ---- new statuses become (unsorted) stages ----
    const statuses = [...new Set(rows.map((r) => r.values.status).filter((s): s is string => Boolean(s)))];
    if (statuses.length) {
      await admin
        .from("hr_stages")
        .upsert(statuses.map((name) => ({ name })), { onConflict: "name", ignoreDuplicates: true });
    }

    await releaseLock(null);
    return { rows: rows.length, changed: changed.length, idsAssigned: idWrites.size, pushed: appOnly.length };
  } catch (e) {
    await releaseLock(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Sync if connected and the last sync is older than `maxAgeMs`. Never throws. */
export async function syncIfStale(maxAgeMs = 120_000): Promise<void> {
  try {
    const conn = await getConnection();
    if (!isExcelReady(conn)) return;
    const last = conn.last_synced_at ? new Date(conn.last_synced_at).getTime() : 0;
    if (Date.now() - last < maxAgeMs) return;
    await syncFromExcel();
  } catch {
    // Recorded in hr_ms_connection.last_error and shown on the pages.
  }
}

/* ---------------- write (app → Excel) ---------------- */

async function writeRow({ conn, layout }: Sheet, row: number, v: Partial<CandidateValues>) {
  const mapped = (Object.entries(layout.cols) as [CandidateField, number][]).filter(([f]) => f in v);
  if (!mapped.length) return;
  const start = Math.min(...mapped.map(([, c]) => c));
  const end = Math.max(...mapped.map(([, c]) => c));
  const cells: (string | null)[] = Array(end - start + 1).fill(null);
  for (const [f, c] of mapped) {
    const val = v[f] ?? "";
    const url = f === "resume_url" ? asUrl(val) : null;
    cells[c - start] = url ? hyperlinkFormula(url) : val;
  }
  await writeBlock(conn.drive_id, conn.item_id, conn.sheet_name, row, start, [cells]);
}

/** Write only `changes` for one candidate. `expected` holds what the app last
    synced for those fields; if the Excel no longer matches, nothing is
    written and ExcelConflictError is thrown. Returns the sheet row, or null
    when Excel isn't connected (the change then stays app-only). */
export async function patchCandidateInExcel(
  code: string,
  changes: Partial<CandidateValues>,
  expected: Partial<CandidateValues>,
): Promise<number | null> {
  const conn = await getConnection();
  if (!isExcelReady(conn)) return null;
  if (!Object.keys(changes).length) return null;

  const sheet = await loadSheet(conn);
  const ids = await readIdColumn(sheet);
  const row = ids.get(code.toUpperCase());
  if (!row) {
    throw new ExcelConflictError(`${code} isn't in the Excel any more (deleted or ID edited). Run a sync and try again.`);
  }

  const { layout, firstCol } = sheet;
  const current = rowToValues(
    (await readRange(conn.drive_id, conn.item_id, conn.sheet_name, `${colLetter(firstCol)}${row}:${colLetter(layout.lastCol)}${row}`))[0] ?? [],
    layout,
    firstCol,
  );
  // The Resume cell shows a file name, not the link, so it can't be compared.
  const drifted = (Object.keys(changes) as CandidateField[]).filter(
    (f) => f !== "resume_url" && layout.cols[f] !== undefined && !sameCell(current[f], expected[f]),
  );
  if (drifted.length) {
    throw new ExcelConflictError(
      `Someone changed ${drifted.map((f) => FIELD_LABELS[f]).join(", ")} for ${code} in the Excel since the last sync. ` +
        "The latest values have been loaded — please make your change again.",
    );
  }

  await writeRow(sheet, row, changes);
  return row;
}

/** Append a new candidate row (quick add). Also returns the ID used, taken
    as the next number after every ID in both the sheet and the database. */
export async function appendCandidateToExcel(values: Omit<CandidateValues, "candidate_code">): Promise<{ row: number; code: string } | null> {
  const conn = await getConnection();
  if (!isExcelReady(conn)) return null;
  const sheet = await loadSheet(conn);
  const ids = await readIdColumn(sheet);
  const code = await nextCandidateCode([...ids.keys()]);
  const row = sheet.layout.lastRow + 1;
  await writeRow(sheet, row, { ...values, candidate_code: code });
  return { row, code };
}

export async function nextCandidateCode(extraCodes: string[] = []): Promise<string> {
  const admin = createAdminClient();
  const data = await selectAll<{ candidate_code: string }>(() =>
    admin.from("hr_candidates").select("candidate_code").order("candidate_code"),
  );
  const max = [...data.map((d) => d.candidate_code), ...extraCodes].reduce((m, c) => Math.max(m, codeNumber(c)), 0);
  return formatCode(max + 1);
}
