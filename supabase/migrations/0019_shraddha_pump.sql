-- Fuel-source tracking, narrowed to the one case that matters: the two
-- sites that fill at the sister company (Shraddha) pump. Everywhere else a
-- fill is just a fill at the day's API rate and the source is irrelevant.
--
-- shraddha_pump marks a site whose machines draw fuel from Shraddha's pump.
-- On those sites the daily report asks, per fill, whether it came from the
-- Shraddha pump or a regular/outside pump. Cost is the API day-rate either
-- way — this is a tracking/reconciliation dimension, not a costing input.

alter table projects add column if not exists shraddha_pump boolean not null default false;

-- Repurpose daily_logs.fuel_source (added in 0018 as own_pump/outside — a
-- guess that didn't match reality). It now records, for a fill at a
-- Shraddha-pump site, whether it was 'shraddha' or 'outside'. Clear the
-- earlier guessed values (pre-feature test data) and swap the constraint.
update daily_logs set fuel_source = null where fuel_source is not null;

alter table daily_logs drop constraint if exists daily_logs_fuel_source_check;
alter table daily_logs
  add constraint daily_logs_fuel_source_check
  check (fuel_source is null or fuel_source in ('shraddha', 'outside'));
