import fs from "node:fs";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

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
  if (sk) { if (!excelBySuffix.has(sk)) excelBySuffix.set(sk, []); excelBySuffix.get(sk).push(a); }
}

// Answer the orphan question: what does BP30/VENU/2018/0002 map to?
const orphanCandidate = excelAssets.find(a => a.jobNo === "BP30/VENU/2018/0002");
console.log("BP30/VENU/2018/0002 (closest match to our orphan) =>", orphanCandidate);

const { data: machines } = await sb.from("machines").select("id,name,registration_no,project_id");
const { data: projects } = await sb.from("projects").select("id,code,name");
const projByCode = new Map(projects.map(p => [p.code, p]));

const SKIP = new Set(["TEMPO TRAVELLER/FORCE/2026/6900"]); // explicit user override, not a bug

let applied = 0;
const failures = [];
for (const m of machines) {
  if (SKIP.has(m.name)) continue;
  let match = null;
  if (m.registration_no) {
    match = excelByPlate.get(m.registration_no.toUpperCase().replace(/\s+/g, "")) ?? null;
  }
  if (!match) {
    const sk = suffixKey(m.name);
    const cands = sk ? excelBySuffix.get(sk) ?? [] : [];
    if (cands.length >= 1) match = cands[0];
  }
  if (!match || !match.siteCode) continue;
  const excelSite = projByCode.get(match.siteCode);
  if (!excelSite) continue;
  if (excelSite.id === m.project_id) continue;

  const { error } = await sb.from("machines").update({ project_id: excelSite.id }).eq("id", m.id);
  if (error) failures.push({ name: m.name, error: error.message });
  else applied++;
}
console.log("\nApplied:", applied, "site corrections. Failures:", failures.length);
if (failures.length) console.log(failures);
