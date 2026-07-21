import fs from "node:fs";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ---- Excel ----
const wb = XLSX.readFile("C:/Users/admin/Documents/Machinery/VERFIED MACHINERY ASSETS.xlsx");
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Sheet1"], { defval: "" });

const plateRe = /[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{3,4}/;
function cleanPlate(raw) {
  const m = String(raw).toUpperCase().match(new RegExp(plateRe, "g"));
  return m ? m[m.length - 1].replace(/\s+/g, "") : null;
}
function suffixKey(jobNo) {
  const parts = jobNo.split("/");
  return parts.length >= 3 ? parts.slice(-3).join("/").toUpperCase() : null;
}

const assetRows = rows
  .filter((r) => {
    const remarks = String(r["Remarks"] ?? "").trim();
    const jobNo = String(r["Job Task No."] ?? "").trim();
    return plateRe.test(remarks) || (jobNo.split("/").length >= 3 && r["Job Task Type"] !== "Heading");
  })
  .map((r) => ({
    jobNo: String(r["Job Task No."] ?? "").trim(),
    siteCode: String(r["Site Code"] ?? "").trim(),
    plate: cleanPlate(r["Remarks"]),
  }));
const seen = new Set();
const excelAssets = assetRows.filter((r) => {
  const k = `${r.jobNo}|${r.siteCode}|${r.plate}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const excelByPlate = new Map();
const excelBySuffix = new Map();
for (const a of excelAssets) {
  if (a.plate) excelByPlate.set(a.plate, a);
  const sk = suffixKey(a.jobNo);
  if (sk) {
    if (!excelBySuffix.has(sk)) excelBySuffix.set(sk, []);
    excelBySuffix.get(sk).push(a);
  }
}

// ---- DB ----
const { data: machines } = await sb.from("machines").select("id,name,registration_no,project_id,is_active");
const { data: projects } = await sb.from("projects").select("id,code,name");
const projById = new Map(projects.map(p => [p.id, p]));
const projByCode = new Map(projects.map(p => [p.code, p]));

const mismatches = [];
const noExcelMatch = [];
const unresolvableCode = [];

for (const m of machines) {
  const curSite = projById.get(m.project_id);
  let match = null;

  if (m.registration_no) {
    const plate = m.registration_no.toUpperCase().replace(/\s+/g, "");
    match = excelByPlate.get(plate) ?? null;
  }
  if (!match) {
    const sk = suffixKey(m.name);
    const candidates = sk ? excelBySuffix.get(sk) ?? [] : [];
    if (candidates.length === 1) match = candidates[0];
    else if (candidates.length > 1) match = candidates[0]; // ambiguous, still use first
  }

  if (!match) {
    noExcelMatch.push(m);
    continue;
  }

  if (!match.siteCode) continue; // excel row itself has no code, can't judge
  const excelSite = projByCode.get(match.siteCode);
  if (!excelSite) {
    unresolvableCode.push({ machine: m.name, code: match.siteCode });
    continue;
  }
  if (excelSite.id !== m.project_id) {
    mismatches.push({
      machine: m.name,
      plate: m.registration_no,
      active: m.is_active,
      dbSite: curSite ? `${curSite.code} · ${curSite.name}` : "—",
      excelSite: `${excelSite.code} · ${excelSite.name}`,
    });
  }
}

console.log("Total DB machines:", machines.length);
console.log("Matched to an Excel row:", machines.length - noExcelMatch.length);
console.log("No Excel match at all:", noExcelMatch.length);
console.log("Excel site code not found in projects table:", unresolvableCode.length);
console.log("SITE MISMATCHES:", mismatches.length);

console.log("\n=== SITE MISMATCHES (Excel is source of truth) ===");
for (const x of mismatches) {
  console.log(`  ${x.machine.padEnd(30)} plate=${(x.plate ?? "-").padEnd(12)} active=${x.active}  DB=[${x.dbSite}]  EXCEL=[${x.excelSite}]`);
}

console.log("\n=== NO EXCEL MATCH FOUND (in DB, not found in verified sheet) ===");
for (const m of noExcelMatch) {
  const s = projById.get(m.project_id);
  console.log(`  ${m.name.padEnd(30)} plate=${m.registration_no ?? "-"} site=${s ? s.code : "?"} active=${m.is_active}`);
}

console.log("\n=== UNRESOLVABLE EXCEL SITE CODES ===");
for (const u of unresolvableCode) console.log(" ", u);
