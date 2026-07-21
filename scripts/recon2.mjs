import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log("--- Office / Store holding sites ---");
console.log((await sb.from("projects").select("id,code,name").in("code", ["OFFICE","STORE"])).data);

console.log("--- Godhra-named projects ---");
console.log((await sb.from("projects").select("id,code,name").ilike("name", "%GODHRA%")).data);

console.log("--- An already-matched Godhra car, to see convention ---");
console.log((await sb.from("machines").select("name,project_id").eq("name","CAR/EECO/2025/1500")).data);
// SLAJ/AJAX/2016/8880 was GODHRA in excel and had a plate match
console.log((await sb.from("machines").select("name,project_id,registration_no").eq("registration_no","GJ21QQ8880")).data);

console.log("--- An already-matched Rajkot car/machine, to see convention ---");
console.log((await sb.from("machines").select("name,project_id,registration_no").eq("registration_no","GJ21W7737")).data); // TOYO/2015/7737 rajkot? just guess plate
console.log((await sb.from("machines").select("name,project_id,registration_no").ilike("name","%TOYO/2015/7737%")).data);

console.log("--- Any existing machine with project_id = OFFICE, sample ---");
const office = (await sb.from("projects").select("id").eq("code","OFFICE")).data[0];
console.log((await sb.from("machines").select("name").eq("project_id", office.id)).data);

console.log("--- BP45 / CS10 VENUS jamnagar already present? ---");
console.log((await sb.from("machines").select("name,project_id").ilike("name","%VENUS%")).data);
console.log((await sb.from("machines").select("name,project_id").ilike("name","%BP45%")).data);
console.log((await sb.from("machines").select("name,project_id").ilike("name","%BATCHING PLANT 45%")).data);
