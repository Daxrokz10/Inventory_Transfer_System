-- Where a fill came from. There's no on-site storage (no tank/barrels) —
-- every fill happens at a pump and is priced at that day's API rate, so
-- this is purely a tracking dimension, not a costing input:
--   own_pump = the company's own / nearby pump (the normal case)
--   outside  = a commercial pump (some cars, occasionally)
-- Null on rows with no fuel issued (breakdown/maintenance/meter-only days).

alter table daily_logs
  add column if not exists fuel_source text
  check (fuel_source is null or fuel_source in ('own_pump', 'outside'));
