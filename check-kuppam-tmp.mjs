import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const { data: project } = await supabase.from("projects").select("*").eq("code", "P-012").single();
console.log("project:", JSON.stringify(project, null, 2));

const { data: logs } = await supabase
  .from("daily_logs")
  .select("log_date, fuel_issued_liters, rate_per_liter, total_cost, machine_id")
  .eq("project_id", project.id)
  .order("log_date", { ascending: false })
  .limit(20);
console.log("recent logs:", JSON.stringify(logs, null, 2));

const { data: prices } = await supabase
  .from("fuel_prices")
  .select("*")
  .order("price_date", { ascending: false })
  .limit(10);
console.log("recent fuel_prices rows (any state):", JSON.stringify(prices, null, 2));
