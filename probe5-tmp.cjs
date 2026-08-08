const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1].trim();
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

(async () => {
  // What is "8115" actually?
  const { data: m } = await db
    .from("machines")
    .select("id, name, registration_no, machine_type, reading_type, project_id, is_active")
    .or("name.ilike.%8115%,registration_no.ilike.%8115%");
  console.log("machines matching 8115:");
  for (const x of m ?? [])
    console.log(`  ${x.name} | plate ${x.registration_no} | type ${x.machine_type} | metered in ${x.reading_type} | active ${x.is_active}`);

  // Did it report in the window the assistant was looking at?
  const ids = (m ?? []).map((x) => x.id);
  if (ids.length) {
    const { data: logs } = await db
      .from("daily_logs")
      .select("log_date, fuel_issued_liters, opening_reading, closing_reading")
      .in("machine_id", ids)
      .gte("log_date", "2026-08-01")
      .lte("log_date", "2026-08-08")
      .order("log_date");
    console.log(`\nlogs 2026-08-01..08: ${(logs ?? []).length}`);
    for (const l of logs ?? [])
      console.log(`  ${l.log_date}: ${l.fuel_issued_liters} L, ${l.opening_reading} -> ${l.closing_reading}`);
  }

  // Is there any machine at all whose average is 3.82 L/hr or 3.73 L/hr?
  const { data: dump } = await db
    .from("machines")
    .select("name, registration_no")
    .ilike("name", "%DUMPER%")
    .limit(5);
  console.log("\nDUMPERs (the model quoted 'GJ 38 T 1577'):");
  for (const d of dump ?? []) console.log(`  ${d.name} | ${d.registration_no}`);
})();
