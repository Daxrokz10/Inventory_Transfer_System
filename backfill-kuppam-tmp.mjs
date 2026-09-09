import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const projectId = "43be78c9-3450-4bd4-8ed9-317cdd59923e"; // P-012 NDDB KUPPAM

const { data: logs } = await supabase
  .from("daily_logs")
  .select("id, log_date, fuel_issued_liters, rate_per_liter, machine_id, machines(fuel_type)")
  .eq("project_id", projectId)
  .is("rate_per_liter", null)
  .gt("fuel_issued_liters", 0);
console.log(`${logs.length} logs with null rate to backfill`);

const { data: prices } = await supabase
  .from("fuel_prices")
  .select("price_date, fuel_type, price")
  .eq("location", "Vijayawada")
  .order("price_date");

// Same "cache exact date, else most recent prior date" fallback the app itself uses.
function priceFor(fuelType, date) {
  const sameDay = prices.find((p) => p.price_date === date && p.fuel_type === fuelType);
  if (sameDay) return sameDay.price;
  const prior = prices.filter((p) => p.price_date <= date && p.fuel_type === fuelType).sort((a, b) => (a.price_date < b.price_date ? 1 : -1));
  return prior[0]?.price ?? null;
}

for (const l of logs) {
  const fuelType = l.machines?.fuel_type === "petrol" ? "petrol" : "diesel";
  const rate = priceFor(fuelType, l.log_date);
  if (rate == null) {
    console.log("NO PRICE AVAILABLE for", l.log_date, "- skipping", l.id);
    continue;
  }
  const total_cost = Number((rate * Number(l.fuel_issued_liters)).toFixed(2));
  console.log("[DRY RUN]", l.log_date, l.fuel_issued_liters, "L ->", rate, "/L =", total_cost, "  id:", l.id);
}
