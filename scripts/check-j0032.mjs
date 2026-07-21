import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log("--- ALL rows with code J-0032 ---");
console.log((await sb.from("projects").select("*").eq("code", "J-0032")).data);

console.log("\n--- Is there a unique constraint on projects.code? ---");
const { data, error } = await sb.rpc("pg_get_constraintdef", {}).catch(() => ({data:null,error:"n/a"}));
console.log("skip rpc check, error:", error);
