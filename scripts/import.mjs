// Phase 1 importer — loads projects, items and opening balances from the
// source spreadsheets in data/source/ into Supabase.
//
//   node scripts/import.mjs
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local
import { createRequire } from "module";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

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

const DIR = "data/source";
const STOCK = "Stock Report_Final 1.xlsx";

function sheet(file, name) {
  const wb = XLSX.readFile(`${DIR}/${file}`);
  return XLSX.utils.sheet_to_json(wb.Sheets[name], {
    header: 1,
    raw: true,
    defval: null,
  });
}

const clean = (v) => (v == null ? null : String(v).trim() || null);
const num = (v) => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const isProjectCode = (s) => typeof s === "string" && /^(J|P)-\d+$/i.test(s.trim());

async function main() {
  const data = sheet(STOCK, "DATA");

  // ---- projects (cols A,B) ----
  const projects = new Map();
  for (let r = 1; r < data.length; r++) {
    const code = clean(data[r][0]);
    if (!code) continue;
    projects.set(code, { code, name: clean(data[r][1]) ?? code });
  }

  // ---- items (cols D..I) ----
  const items = new Map();
  for (let r = 1; r < data.length; r++) {
    const code = clean(data[r][3]);
    if (!code) continue;
    items.set(code, {
      code,
      description: clean(data[r][4]) ?? code,
      unit: clean(data[r][5]) ?? "NOS",
      sub_group: clean(data[r][6]),
      main_group: clean(data[r][7]),
      per_day_rate: num(data[r][8]),
    });
  }

  // ---- enrich projects from CHALAN DATA (branch, GSTIN, transporter) ----
  // Also build HSN map: main_group keyword → hsn_code
  const CHALAN = "UPDATED CHALAN.xlsx";
  const chalData = sheet(CHALAN, "DATA");
  const hsnByDesc = new Map(); // normalised description → hsn code
  for (let r = 1; r < chalData.length; r++) {
    const code = clean(chalData[r][0]);
    const branch = clean(chalData[r][9]);
    const gstin = clean(chalData[r][10]);
    const transporterName = clean(chalData[r][12]);
    const transporterId = clean(chalData[r][13]);
    if (code && projects.has(code)) {
      const p = projects.get(code);
      if (branch) p.branch = branch;
      if (gstin) p.gstin = gstin;
      if (transporterName) p.transporter_name = transporterName;
      if (transporterId) p.transporter_id = transporterId;
    }
    // HSN code mapping from item description
    const desc = clean(chalData[r][4]);
    const hsn = chalData[r][5] ? String(chalData[r][5]).trim() : null;
    if (desc && hsn) hsnByDesc.set(desc.toLowerCase(), hsn);
  }
  console.log(`CHALAN enriched projects; ${hsnByDesc.size} HSN mappings.`);

  // Apply HSN to items by matching description keywords
  for (const item of items.values()) {
    const d = (item.description ?? "").toLowerCase();
    for (const [key, hsn] of hsnByDesc) {
      if (d.includes(key) || key.includes(d.split(" ")[0])) {
        item.hsn_code = hsn;
        break;
      }
    }
    // Fallback: match by main_group keywords
    if (!item.hsn_code) {
      const g = (item.main_group ?? "").toLowerCase();
      for (const [key, hsn] of hsnByDesc) {
        if (key.includes(g.split(" ")[0]) || g.split(" ")[0].length > 2 && key.includes(g.split(" ")[0])) {
          item.hsn_code = hsn;
          break;
        }
      }
    }
  }

  console.log(`Parsed ${projects.size} projects, ${items.size} items.`);

  // ---- upsert masters ----
  let res = await supabase
    .from("projects")
    .upsert([...projects.values()], { onConflict: "code" });
  if (res.error) throw res.error;
  res = await supabase
    .from("items")
    .upsert([...items.values()], { onConflict: "code" });
  if (res.error) throw res.error;
  console.log("Upserted projects + items.");

  // ---- id maps ----
  const projMap = new Map();
  const itemMap = new Map();
  for (const page of ["projects", "items"]) {
    const { data: rows, error } = await supabase
      .from(page)
      .select("id, code");
    if (error) throw error;
    const target = page === "projects" ? projMap : itemMap;
    for (const row of rows) target.set(row.code, row.id);
  }

  // ---- opening balances (matrix) ----
  const ob = sheet(STOCK, "Opening Balance");
  const header = ob[1];
  const projCols = []; // [{ index, code }]
  header.forEach((h, i) => {
    if (isProjectCode(h)) projCols.push({ index: i, code: clean(h) });
  });

  const balances = [];
  let missingItem = 0;
  let missingProj = 0;
  for (let r = 2; r < ob.length; r++) {
    const itemCode = clean(ob[r][0]);
    if (!itemCode) continue;
    const itemId = itemMap.get(itemCode);
    if (!itemId) {
      missingItem++;
      continue;
    }
    for (const { index, code } of projCols) {
      const qty = num(ob[r][index]);
      if (Math.abs(qty) < 1e-9) continue;
      const projId = projMap.get(code);
      if (!projId) {
        missingProj++;
        continue;
      }
      balances.push({ project_id: projId, item_id: itemId, qty });
    }
  }
  console.log(
    `Opening balances: ${balances.length} non-zero cells across ${projCols.length} project columns` +
      (missingItem ? ` (skipped ${missingItem} unknown item rows)` : "") +
      (missingProj ? ` (skipped ${missingProj} unknown project cells)` : ""),
  );

  // batch upsert
  for (let i = 0; i < balances.length; i += 1000) {
    const chunk = balances.slice(i, i + 1000);
    const { error } = await supabase
      .from("opening_balances")
      .upsert(chunk, { onConflict: "project_id,item_id" });
    if (error) throw error;
  }
  console.log("Upserted opening balances. Done.");
}

main().catch((e) => {
  console.error("IMPORT FAILED:", e.message ?? e);
  process.exit(1);
});
