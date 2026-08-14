import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const MAX_KM_PER_L = 50;
const MIN_L_PER_HR = 1;

function computeFillMetrics(machine, logs, currentReading) {
  const fillDays = logs
    .filter((l) => Number(l.fuel_issued_liters) > 0 && l.closing_reading != null)
    .sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));
  const isHours = machine.reading_type === "hours";
  const results = [];
  for (let i = 0; i < fillDays.length; i++) {
    const fill = fillDays[i];
    const next = fillDays[i + 1];
    const endReading = next ? next.closing_reading : (currentReading ?? null);
    if (endReading == null) continue;
    const distance = Number(endReading) - Number(fill.closing_reading);
    const fuel = Number(fill.fuel_issued_liters);
    if (distance <= 0 || fuel <= 0) continue;
    const value = isHours ? fuel / distance : distance / fuel;
    const unit = isHours ? "L/hr" : "km/L";
    const plausible = isHours ? value >= MIN_L_PER_HR : value <= MAX_KM_PER_L;
    results.push({ log_id: fill.id, log_date: fill.log_date, value, unit, plausible, provisional: !next });
  }
  return results;
}

const ids = [
  ["7800", "c8ddb0b7-52e8-45a1-be32-8215f21bcd32"],
  ["9240G", "f843065c-6c1e-4247-8d81-dc9c387f1572"],
  ["6000", "ad4a3201-9333-4864-98ec-ff1c9554ccc6"],
  ["9240M", "3b818248-4f95-4e3f-bb44-67b8bbd7b451"],
];
for (const [label, id] of ids) {
  const { data: machine } = await supabase.from("machines").select("*").eq("id", id).single();
  const { data: logs } = await supabase.from("daily_logs").select("*").eq("machine_id", id);
  const metrics = computeFillMetrics(machine, logs, machine.current_reading);
  console.log(label, JSON.stringify(metrics));
}
