import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log("--- P-011 ---");
console.log((await sb.from("projects").select("id,code,name").eq("code", "P-011")).data);

console.log("--- AARTI/AARATI/SAFFRON sites ---");
console.log((await sb.from("projects").select("id,code,name").or("name.ilike.%AAR%SAFFRON%,name.ilike.%SAFFRON%")).data);

console.log("--- RIL site(s) ---");
console.log((await sb.from("projects").select("id,code,name").ilike("name", "%RIL%")).data);

console.log("--- CAR/CAMP/2024/6171 (known RIL DAHEJ machine) project ---");
const camp = (await sb.from("machines").select("id,name,project_id,registration_no").eq("name", "CAR/CAMP/2024/6171")).data;
console.log(camp);
if (camp?.[0]) console.log("its site:", (await sb.from("projects").select("id,code,name").eq("id", camp[0].project_id)).data);

console.log("--- Check the 7 target cars by exact name (with/without plate) ---");
const names = [
  "CAR/BOLERO/2026/8700","CAR/CAMP/2026/2400","CAR/ECCO/2025/1500",
  "CAR/HYUN/2024/5329","CAR/MAHI/2019/7575","CAR/RITZ/2022/3480","CAR/TOYO/2023/3709",
];
for (const n of names) {
  const r = (await sb.from("machines").select("id,name,registration_no,project_id").eq("name", n)).data;
  console.log(n, "=>", r.length ? r : "NOT FOUND");
}

console.log("--- Check tractor TRAC/SWAR/2026/4522 ---");
console.log((await sb.from("machines").select("id,name,registration_no,project_id").ilike("name", "%SWAR/2026/4522%")).data);

console.log("--- All TRAC/SWAR machines (to see naming pattern used) ---");
console.log((await sb.from("machines").select("id,name,registration_no,project_id").ilike("name", "%SWAR%")).data);

console.log("--- machine_type list currently in use ---");
const { data: types } = await sb.from("machines").select("machine_type");
console.log([...new Set(types.map(t=>t.machine_type))].sort());
