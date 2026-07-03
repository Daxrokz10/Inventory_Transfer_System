// Opening-balance re-seed importer.
//
// Loads CORRECTED opening stock (qty per site + item) from a spreadsheet you
// provide and writes it to the `opening_balances` table. It does NOT touch
// items/projects masters and does NOT restore the old numbers — it only uses
// the file you point it at.
//
// Usage:
//   node scripts/import-opening-balances.mjs <path-to-file.xlsx> [sheetName] [flags]
//
// Flags:
//   --dry        Preview only: parse + validate, print a summary, write nothing.
//   --replace    Wipe ALL existing opening_balances first, then insert (clean
//                re-seed). Without it, rows are upserted on (project_id,item_id)
//                so removed cells are NOT zeroed.
//
// Accepted spreadsheet layouts (auto-detected):
//   1) MATRIX  — a header row containing site codes (J-0033, P-003, …) across
//                columns; the first column holds the item code; cells hold qty.
//   2) LONG    — columns named like item/item_code, site/project/site_code,
//                qty/quantity/opening. One row per (item, site).
//
// Codes are matched (case-insensitive, trimmed) against existing items.code and
// projects.code. Unknown codes are skipped and reported. J-0000 (purchase
// source) is never given an opening balance.
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local
import { createRequire } from "module";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// ---- args ----
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const FILE = positional[0];
const SHEET = positional[1] ?? null;
const DRY = flags.has("--dry");
const REPLACE = flags.has("--replace");

if (!FILE) {
  console.error("Usage: node scripts/import-opening-balances.mjs <file.xlsx> [sheet] [--dry] [--replace]");
  process.exit(1);
}

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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- helpers ----
const clean = (v) => (v == null ? null : String(v).trim() || null);
const num = (v) => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const isProjectCode = (s) => typeof s === "string" && /^(J|P)-?\d+$/i.test(s.trim());
const normCode = (s) => (s == null ? "" : String(s).trim().toUpperCase());

const LONG_ITEM = ["item", "item_code", "itemcode", "code", "material", "material_code"];
const LONG_SITE = ["site", "site_code", "sitecode", "project", "project_code", "projectcode", "godown", "location"];
const LONG_QTY = ["qty", "quantity", "opening", "opening_balance", "balance", "stock", "on_hand", "onhand"];

function readGrid(file, sheetName) {
  const wb = XLSX.readFile(file);
  const names = sheetName ? [sheetName] : wb.SheetNames;
  for (const nm of names) {
    const ws = wb.Sheets[nm];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (grid.length) return { name: nm, grid };
  }
  throw new Error(sheetName ? `Sheet "${sheetName}" not found or empty.` : "No non-empty sheet found.");
}

// Detect a matrix: a row within the first 8 that has >=2 project-code cells.
function findMatrixHeader(grid) {
  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const row = grid[r] ?? [];
    const projCols = [];
    row.forEach((h, i) => {
      if (isProjectCode(h)) projCols.push({ index: i, code: normCode(h) });
    });
    if (projCols.length >= 2) {
      // item-code column = the first column left of the project columns (usually 0)
      const firstProj = Math.min(...projCols.map((p) => p.index));
      const itemCol = firstProj > 0 ? 0 : null;
      return { headerRow: r, projCols, itemCol };
    }
  }
  return null;
}

function findLongHeader(grid) {
  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const row = (grid[r] ?? []).map((c) => (c == null ? "" : String(c).trim().toLowerCase().replace(/\s+/g, "_")));
    const itemIdx = row.findIndex((c) => LONG_ITEM.includes(c));
    const siteIdx = row.findIndex((c) => LONG_SITE.includes(c));
    const qtyIdx = row.findIndex((c) => LONG_QTY.includes(c));
    if (itemIdx >= 0 && siteIdx >= 0 && qtyIdx >= 0) {
      return { headerRow: r, itemIdx, siteIdx, qtyIdx };
    }
  }
  return null;
}

async function main() {
  const { name, grid } = readGrid(FILE, SHEET);
  console.log(`Reading "${FILE}" → sheet "${name}" (${grid.length} rows)`);

  // ---- code → id maps from the DB ----
  const itemMap = new Map();
  const projMap = new Map();
  {
    const [{ data: items, error: ie }, { data: projs, error: pe }] = await Promise.all([
      supabase.from("items").select("id, code"),
      supabase.from("projects").select("id, code"),
    ]);
    if (ie) throw ie;
    if (pe) throw pe;
    for (const it of items ?? []) itemMap.set(normCode(it.code), it.id);
    for (const p of projs ?? []) projMap.set(normCode(p.code), p.id);
  }
  console.log(`DB has ${itemMap.size} items, ${projMap.size} sites.`);

  // ---- parse cells → { project_id, item_id, qty } ----
  const cells = [];
  const unknownItems = new Set();
  const unknownSites = new Set();
  let skippedPurchase = 0;

  const matrix = findMatrixHeader(grid);
  const long = matrix ? null : findLongHeader(grid);

  if (matrix) {
    console.log(`Detected MATRIX layout: header row ${matrix.headerRow + 1}, ${matrix.projCols.length} site columns.`);
    const itemCol = matrix.itemCol ?? 0;
    for (let r = matrix.headerRow + 1; r < grid.length; r++) {
      const itemCode = normCode(grid[r]?.[itemCol]);
      if (!itemCode) continue;
      const itemId = itemMap.get(itemCode);
      if (!itemId) { unknownItems.add(itemCode); continue; }
      for (const { index, code } of matrix.projCols) {
        const qty = num(grid[r][index]);
        if (Math.abs(qty) < 1e-9) continue;
        if (code === "J-0000" || code === "J0000") { skippedPurchase++; continue; }
        const projId = projMap.get(code);
        if (!projId) { unknownSites.add(code); continue; }
        cells.push({ project_id: projId, item_id: itemId, qty });
      }
    }
  } else if (long) {
    console.log(`Detected LONG layout: header row ${long.headerRow + 1} (item, site, qty columns).`);
    for (let r = long.headerRow + 1; r < grid.length; r++) {
      const itemCode = normCode(grid[r]?.[long.itemIdx]);
      const siteCode = normCode(grid[r]?.[long.siteIdx]);
      if (!itemCode || !siteCode) continue;
      const qty = num(grid[r][long.qtyIdx]);
      if (Math.abs(qty) < 1e-9) continue;
      const itemId = itemMap.get(itemCode);
      if (!itemId) { unknownItems.add(itemCode); continue; }
      if (siteCode === "J-0000" || siteCode === "J0000") { skippedPurchase++; continue; }
      const projId = projMap.get(siteCode);
      if (!projId) { unknownSites.add(siteCode); continue; }
      cells.push({ project_id: projId, item_id: itemId, qty });
    }
  } else {
    throw new Error(
      "Could not detect layout. For MATRIX, a header row must contain site codes like J-0033/P-003. " +
      "For LONG, include columns named item/site/qty. Pass the sheet name as the 2nd argument if needed.",
    );
  }

  // ---- merge duplicate (site,item) cells by summing ----
  const merged = new Map();
  for (const c of cells) {
    const k = `${c.project_id}|${c.item_id}`;
    merged.set(k, (merged.get(k) ?? 0) + c.qty);
  }
  const rows = [...merged.entries()]
    .map(([k, qty]) => { const [project_id, item_id] = k.split("|"); return { project_id, item_id, qty }; })
    .filter((r) => Math.abs(r.qty) > 1e-9);

  // ---- report ----
  const siteCount = new Set(rows.map((r) => r.project_id)).size;
  const itemCount = new Set(rows.map((r) => r.item_id)).size;
  console.log("");
  console.log(`Parsed ${rows.length} non-zero balances across ${siteCount} sites × ${itemCount} items.`);
  if (skippedPurchase) console.log(`Skipped ${skippedPurchase} cell(s) for reserved J-0000 purchase source.`);
  if (unknownItems.size) console.log(`⚠ ${unknownItems.size} unknown item code(s) skipped: ${[...unknownItems].slice(0, 15).join(", ")}${unknownItems.size > 15 ? " …" : ""}`);
  if (unknownSites.size) console.log(`⚠ ${unknownSites.size} unknown site code(s) skipped: ${[...unknownSites].join(", ")}`);

  if (DRY) {
    console.log("\n--dry: nothing written. Sample of first 10 rows:");
    console.table(rows.slice(0, 10));
    return;
  }
  if (rows.length === 0) {
    console.log("Nothing to write.");
    return;
  }

  if (REPLACE) {
    const { error } = await supabase.from("opening_balances").delete().not("project_id", "is", null);
    if (error) throw error;
    console.log("Cleared existing opening_balances (--replace).");
  }

  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const { error } = await supabase
      .from("opening_balances")
      .upsert(chunk, { onConflict: "project_id,item_id" });
    if (error) throw error;
  }
  console.log(`Wrote ${rows.length} opening balances. Done.`);
}

main().catch((e) => {
  console.error("IMPORT FAILED:", e.message ?? e);
  process.exit(1);
});
