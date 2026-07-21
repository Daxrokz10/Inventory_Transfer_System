// One-off import of internal machinery from the retired machinery-tracker
// prototype's local seed files into the current machines table.
//
//   node scripts/import-machines.mjs --dry     # preview, writes nothing
//   node scripts/import-machines.mjs           # actually import
//
// Reads the two SQL seed files on disk (no live connection to the old
// project needed), applies the type→(fuel, meter, track_fuel) mapping we
// agreed, resolves sites by project code, parks free-pool machines at
// holding sites (Central Store / Office), and inserts. Idempotent-ish:
// skips a machine if one with the same name already exists at the same
// site.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TRACKER = "C:/Users/admin/Desktop/machinery-tracker";
const DRY = process.argv.includes("--dry");

// ---- env ----
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ---- type → machine config ----
// readable name, meter (km|hours), fuel (diesel|petrol), track_fuel
const TYPE_MAP = {
  "TRMI": ["Transit Mixer", "hours", "diesel", true],
  "DG SET": ["DG Set", "hours", "diesel", true],
  "TRAC": ["Tractor", "km", "diesel", true],
  "CONCRETE PUMP": ["Concrete Pump", "hours", "diesel", true],
  "XENO": ["Pickup (Tata Xenon)", "km", "diesel", true],
  "BUS": ["Bus", "km", "diesel", true],
  "SLAJ": ["Self-Loading Mixer (Ajax)", "hours", "diesel", true],
  "TRLO": ["Tractor Loader", "km", "diesel", true],
  "VBRO": ["Vibratory Roller", "hours", "diesel", true],
  "BABY ROLLER": ["Baby Roller", "hours", "diesel", true],
  "MINI ROLLER": ["Mini Roller", "hours", "diesel", true],
  "BOLERO PICKUP": ["Pickup", "km", "diesel", true],
  "FARANA": ["Farana Crane (ACE)", "hours", "diesel", true],
  "MOBILE CRANE": ["Mobile Crane", "km", "diesel", true],
  "BOOM PLACER": ["Concrete Boom Placer", "hours", "diesel", true],
  "JCB": ["Backhoe Loader (JCB)", "hours", "diesel", true],
  "TEMPO": ["Tempo (LCV)", "km", "diesel", true],
  // asset-only, no fuel
  "CEMENT SILO": ["Cement Silo", "km", "diesel", false],
  "BATCHING PLANT": ["Batching Plant", "km", "diesel", false],
  "TOWER CRANE": ["Tower Crane", "km", "diesel", false],
  // cars — office vehicles, tracked as assets, no fuel; fuel_type is
  // metadata resolved per make below
  "CAR": ["Car / Jeep", "km", null, false],
};

// car make → fuel (metadata only, since cars aren't fuel-tracked)
const CAR_FUEL = {
  CAMP: "diesel", // Bolero Camper
  BOLERO: "diesel",
  TOYO: "diesel",
  TAYOTA: "diesel",
  SCO: "diesel", // Scorpio
  SKODA: "diesel", // Superb
  EECO: "petrol",
  ERTIGA: "petrol", // petrol/CNG
  MARU: "petrol",
  HYUN: "petrol",
};

// Machines to skip entirely (by exact name).
const SKIP = new Set(["CAR/2025/7300"]); // the Creta

function normType(name) {
  const p = name.split("/")[0].trim();
  if (/^DG\d*/i.test(p)) return "DG SET"; // DG100, DG35, DG5, …
  return p.replace(/\s*\d+$/, ""); // "CEMENT SILO 10" → "CEMENT SILO"
}

function carMake(name) {
  const parts = name.split("/");
  return /^\d{4}$/.test(parts[1]) ? "(none)" : parts[1];
}

// pull the last plausible number-plate token out of a messy remarks value
function cleanPlate(raw) {
  if (!raw) return null;
  const plates = raw.match(/[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}/g);
  return plates ? plates[plates.length - 1] : null;
}

// ---- parse seed files ----
const bulk = fs.readFileSync(path.join(TRACKER, "bulk_insert_machines.sql"), "utf8");
const machineRows = [...bulk.matchAll(/\('([^']*)',\s*'([^']*)',\s*(true|false)\)/g)].map(
  (r) => ({ name: r[1], siteName: r[2], isFree: r[3] === "true" }),
);

const plateSql = fs.readFileSync(path.join(TRACKER, "update_vehicle_numbers.sql"), "utf8");
const plateByName = new Map();
for (const r of plateSql.matchAll(/\('([^']*)',\s*'([^']*)'\)/g)) {
  plateByName.set(r[1].toLowerCase(), cleanPlate(r[2]));
}

async function main() {
  // resolve real project codes
  const { data: projects } = await sb.from("projects").select("id, code");
  const idByCode = new Map((projects ?? []).map((p) => [p.code, p.id]));

  // ensure holding sites exist
  async function ensureSite(code, name) {
    if (idByCode.has(code)) return idByCode.get(code);
    if (DRY) {
      console.log(`[dry] would create holding site ${code} (${name})`);
      idByCode.set(code, `DRY-${code}`);
      return idByCode.get(code);
    }
    const { data, error } = await sb
      .from("projects")
      .insert({ code, name, is_active: true })
      .select("id")
      .single();
    if (error) throw new Error(`create site ${code}: ${error.message}`);
    idByCode.set(code, data.id);
    return data.id;
  }
  const storeId = await ensureSite("STORE", "Central Store");
  const officeId = await ensureSite("OFFICE", "Office");

  function resolveSiteId(m, type) {
    if (m.isFree || !m.siteName) {
      // free-pool: cars → Office, everything else → Central Store
      return type === "CAR" ? officeId : storeId;
    }
    let code = (m.siteName.match(/^([A-Z]-?\d+)/) || [])[1];
    if (code === "J-100") code = "J-0100"; // format fix
    return idByCode.get(code) ?? null;
  }

  const toInsert = [];
  const skipped = [];
  for (const m of machineRows) {
    if (SKIP.has(m.name)) {
      skipped.push([m.name, "explicitly skipped"]);
      continue;
    }
    const type = normType(m.name);
    const cfg = TYPE_MAP[type];
    if (!cfg) {
      skipped.push([m.name, `unmapped type "${type}"`]);
      continue;
    }
    const [readable, meter, fuelDefault, track] = cfg;
    const siteId = resolveSiteId(m, type);
    if (!siteId) {
      skipped.push([m.name, `unresolved site "${m.siteName}"`]);
      continue;
    }
    const fuel = type === "CAR" ? CAR_FUEL[carMake(m.name)] ?? "diesel" : fuelDefault;
    toInsert.push({
      name: m.name,
      machine_type: readable,
      reading_type: meter,
      fuel_type: fuel,
      ownership: "internal",
      vendor_name: null,
      registration_no: plateByName.get(m.name.toLowerCase()) ?? null,
      track_fuel: track,
      current_reading: track ? 0 : null,
      current_reading_at: track ? new Date().toISOString() : null,
      project_id: siteId,
    });
  }

  // skip machines that already exist (same name + site)
  const { data: existing } = await sb.from("machines").select("name, project_id, registration_no");
  const existingKey = new Set((existing ?? []).map((e) => `${e.name.toLowerCase()}|${e.project_id}`));
  let fresh = toInsert.filter((m) => !existingKey.has(`${m.name.toLowerCase()}|${m.project_id}`));
  const dupes = toInsert.length - fresh.length;

  // dedupe within the batch (and against existing rows) on the unique
  // (project_id, registration_no) constraint — the source data lists a
  // couple of vehicles twice. Keep the first; drop later collisions.
  const seenPlate = new Set(
    (existing ?? [])
      .filter((e) => e.registration_no)
      .map((e) => `${e.project_id}|${e.registration_no}`),
  );
  const plateSkipped = [];
  fresh = fresh.filter((m) => {
    if (!m.registration_no) return true;
    const key = `${m.project_id}|${m.registration_no}`;
    if (seenPlate.has(key)) {
      plateSkipped.push([m.name, m.registration_no]);
      return false;
    }
    seenPlate.add(key);
    return true;
  });

  console.log(`Parsed ${machineRows.length} machines from seed.`);
  console.log(`  to insert: ${fresh.length}`);
  console.log(`  already present (skipped): ${dupes}`);
  console.log(`  unmapped/skipped: ${skipped.length}`);
  for (const [n, why] of skipped) console.log(`    - ${n}: ${why}`);
  console.log(`  duplicate numberplate at same site (skipped): ${plateSkipped.length}`);
  for (const [n, p] of plateSkipped) console.log(`    - ${n}: plate ${p} already used at that site`);

  // breakdown by type
  const byType = {};
  for (const m of fresh) byType[m.machine_type] = (byType[m.machine_type] ?? 0) + 1;
  console.log("  by type:", JSON.stringify(byType, null, 0));

  if (DRY) {
    console.log("\n[dry run] nothing written. Sample rows:");
    console.log(JSON.stringify(fresh.slice(0, 3), null, 2));
    return;
  }

  // insert row-by-row so one bad row can't roll back the whole batch
  let ok = 0;
  const failed = [];
  for (const m of fresh) {
    const { error } = await sb.from("machines").insert(m);
    if (error) failed.push([m.name, error.message]);
    else ok++;
  }
  console.log(`\nDone — inserted ${ok} machines.`);
  if (failed.length) {
    console.log(`  failed: ${failed.length}`);
    for (const [n, e] of failed) console.log(`    - ${n}: ${e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
