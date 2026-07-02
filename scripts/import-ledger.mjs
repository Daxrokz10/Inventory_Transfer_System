// Phase 2 importer — loads HISTORICAL stock movements from the Excel site tabs
// into the stock_transactions ledger, then runs a reconciliation report against
// the Excel "Closing Balance" sheet so pre-existing Excel errors surface instead
// of being silently inherited.
//
//   node scripts/import-ledger.mjs           # import + reconcile
//   node scripts/import-ledger.mjs --dry     # reconcile only, write nothing
//
// Model (confirmed by validating against the Closing Balance sheet):
//   Each site tab has 4 horizontal ledger blocks, 17 cols each + 1 separator.
//     block1 (A..Q, col 0)  — raw entries, unsigned  (NOT used)
//     block2 (S..AI, col 18) — RECEIVE_IN, positive qty
//     block3 (AK..BA, col 36) — issued, positive qty (display dup, NOT used)
//     block4 (BC..BS, col 54) — ISSUE_OUT, negative qty
//   closing(item,site) = opening + SUM(block2) + SUM(block4)
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local
import { createRequire } from "module";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const DRY = process.argv.includes("--dry");

// ---- env ----
function loadEnv() {
  const txt = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv();
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const FILE = "Stock Report_Final .xlsx"; // uploaded to project root
const wb = XLSX.readFile(FILE, { cellFormula: false });
const grid = (n) =>
  XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });

const S = (v) => (v == null ? null : String(v).trim() || null);
const num = (v) => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const isCode = (s) => typeof s === "string" && /^(J|P)-\d+$/i.test(s.trim());
// Excel serial date -> ISO yyyy-mm-dd
const excelDate = (serial) => {
  const n = num(serial);
  if (!n || n < 20000 || n > 60000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return d.toISOString().slice(0, 10);
};

// block layout
const BLOCKS = [0, 18, 36, 54];
const C = { MONTH: 0, TYPE: 1, DATE: 2, CODE: 3, QTY: 8, RATE: 9, AMOUNT: 10,
  RCVD_FROM: 11, ISSUED_TO: 12, JOB_FROM: 13, ISSUED_CODE: 14, FY: 15, REMARK: 16 };

const SITES = wb.SheetNames.filter((n) => isCode(n));

async function main() {
  // ---- id maps ----
  const projMap = new Map();
  const itemMap = new Map();
  for (const [tbl, map] of [["projects", projMap], ["items", itemMap]]) {
    const { data, error } = await supabase.from(tbl).select("id, code");
    if (error) throw error;
    for (const r of data) map.set(r.code, r.id);
  }

  // ---- parse rows (block2 = receive+, block4 = issue-) ----
  const rows = [];
  let unknownItem = 0;
  const computed = {}; // code -> { item -> netQty }
  SITES.forEach((c) => (computed[c] = {}));

  for (const site of SITES) {
    const projectId = projMap.get(site);
    if (!projectId) continue;
    const g = grid(site);

    for (let r = 2; r < g.length; r++) {
      for (const [bi, off] of [[1, BLOCKS[1]], [3, BLOCKS[3]]]) {
        const code = S(g[r][off + C.CODE]);
        if (!code) continue;
        const qty = num(g[r][off + C.QTY]);
        if (qty === 0) continue;
        // block2 keeps positives (receives), block4 keeps negatives (issues)
        if (bi === 1 && qty <= 0) continue;
        if (bi === 3 && qty >= 0) continue;

        computed[site][code] = (computed[site][code] || 0) + qty;

        const itemId = itemMap.get(code);
        if (!itemId) { unknownItem++; continue; }

        const cpCode = bi === 3 ? S(g[r][off + C.ISSUED_CODE]) : S(g[r][off + C.JOB_FROM]);
        rows.push({
          project_id: projectId,
          item_id: itemId,
          txn_type: bi === 1 ? "RECEIVE_IN" : "ISSUE_OUT",
          signed_qty: qty,
          rate: Math.abs(num(g[r][off + C.RATE])),
          doc_date: excelDate(g[r][off + C.DATE]),
          fiscal_year: S(g[r][off + C.FY]),
          counterparty_project_id: cpCode && projMap.has(cpCode) ? projMap.get(cpCode) : null,
          received_from: S(g[r][off + C.RCVD_FROM]),
          issued_to: S(g[r][off + C.ISSUED_TO]),
          source: "excel-import",
          remarks: S(g[r][off + C.REMARK]),
        });
      }
    }
  }
  console.log(`Parsed ${rows.length} ledger rows from ${SITES.length} site tabs` +
    (unknownItem ? ` (skipped ${unknownItem} rows with unknown item codes)` : ""));

  // ---- reconciliation vs Excel Closing Balance ----
  function matrix(name) {
    const g = grid(name);
    const hdr = g[1] || [];
    const cols = [];
    hdr.forEach((h, i) => { if (isCode(h)) cols.push({ i, code: h.trim() }); });
    const m = {};
    cols.forEach((c) => (m[c.code] = {}));
    for (let r = 2; r < g.length; r++) {
      const it = S(g[r][0]);
      if (!it) continue;
      for (const c of cols) { const q = num(g[r][c.i]); if (q) m[c.code][it] = (m[c.code][it] || 0) + q; }
    }
    return m;
  }
  const excelClosing = matrix("Closing Balance");
  const excelOpening = matrix("Opening Balance");

  const variances = [];
  let cells = 0, tie = 0;
  for (const site of SITES) {
    const op = excelOpening[site] || {}, cl = excelClosing[site] || {}, mv = computed[site] || {};
    const items = new Set([...Object.keys(mv), ...Object.keys(cl), ...Object.keys(op)]);
    for (const it of items) {
      const ourClosing = (op[it] || 0) + (mv[it] || 0);
      const excel = cl[it] || 0;
      cells++;
      if (Math.abs(ourClosing - excel) < 0.001) tie++;
      else variances.push({ site, item: it, excel, corrected: ourClosing, diff: ourClosing - excel });
    }
  }

  console.log(`\nRECONCILIATION vs Excel "Closing Balance":`);
  console.log(`  ${tie}/${cells} cells tie out (${((tie / cells) * 100).toFixed(1)}%)`);
  console.log(`  ${variances.length} cells differ — these are pre-existing Excel errors to review:`);
  variances.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  for (const v of variances.slice(0, 25))
    console.log(`   ${v.site}  ${v.item.padEnd(9)}  excel=${v.excel}  corrected=${v.corrected}  (Δ ${v.diff > 0 ? "+" : ""}${v.diff})`);
  if (variances.length > 25) console.log(`   … and ${variances.length - 25} more`);

  if (DRY) { console.log("\n--dry: no data written."); return; }

  // ---- write (idempotent: clear prior import first) ----
  console.log(`\nClearing previous excel-import rows…`);
  let del = await supabase.from("stock_transactions").delete().eq("source", "excel-import");
  if (del.error) throw del.error;

  console.log(`Inserting ${rows.length} rows…`);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from("stock_transactions").insert(chunk);
    if (error) throw error;
    process.stdout.write(`\r  ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  console.log("\nDone. Historical ledger imported.");
}

main().catch((e) => {
  console.error("\nIMPORT FAILED:", e.message ?? e);
  process.exit(1);
});
