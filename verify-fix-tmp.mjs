import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Reproduce the fixed pagination logic standalone (mirrors the new code).
const PAGE_SIZE = 1000;
let logs = [];
for (let page = 0; ; page++) {
  const { data: pageRows } = await supabase
    .from("daily_logs")
    .select("machine_id, log_date")
    .gte("log_date", "2026-08-01")
    .lte("log_date", "2026-08-31")
    .order("log_date", { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  logs.push(...(pageRows ?? []));
  if (!pageRows || pageRows.length < PAGE_SIZE) break;
}
console.log("total rows fetched with pagination:", logs.length);
console.log("last date present:", logs[logs.length - 1]?.log_date);

// Now check the specific machine from the screenshot: BOPL/TATA/2022/5505
const { data: machine } = await supabase.from("machines").select("id, name").ilike("name", "%5505%").maybeSingle();
console.log("machine:", machine);
const mLogs = logs.filter((l) => l.machine_id === machine.id);
console.log(`${machine.name} logs found in paginated fetch:`, mLogs.map((l) => l.log_date));
