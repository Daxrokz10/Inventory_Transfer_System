-- Decouple "log a reading daily" from "log fuel daily". Batching plants
-- run on electricity (no diesel to track) but their running hours still
-- matter for maintenance scheduling, so they need a spot on the daily
-- report for hours only, with no fuel column expected.
--
-- track_fuel  = ask for liters/cost on the daily report (existing)
-- track_meter = ask for a reading (km/hours) on the daily report (new,
--               independent of track_fuel)

alter table machines add column if not exists track_meter boolean not null default true;

-- Backfill: fuel-tracked machines already log a reading today, so they
-- keep track_meter = true. Non-fuel assets default to no reading either
-- (true fixtures — tower cranes, silos, office cars) EXCEPT batching
-- plants, whose hours are the one thing worth tracking about them.
update machines
set track_meter = (track_fuel or machine_type = 'Batching Plant');
