import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const { count } = await supabase
  .from("daily_logs")
  .select("id", { count: "exact", head: true })
  .gte("log_date", "2026-08-01")
  .lte("log_date", "2026-08-31");
console.log("August 2026 daily_logs rows, all sites:", count);

// Reproduce the exact unfiltered query the report page runs (no .limit()) and
// see where it actually cuts off without an explicit range.
const { data: rows, error } = await supabase
  .from("daily_logs")
  .select("log_date")
  .gte("log_date", "2026-08-01")
  .lte("log_date", "2026-08-31")
  .order("log_date", { ascending: true });
console.log("rows returned by default (no .limit()):", rows?.length, error ?? "");
console.log("last date present in the returned set:", rows?.[rows.length - 1]?.log_date);
