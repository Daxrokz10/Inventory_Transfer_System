import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
console.log((await sb.from("projects").select("id,code,name").eq("id","663974ab-dfe9-400c-8c96-fce5071d73eb")).data);
