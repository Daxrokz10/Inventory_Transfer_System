-- =============================================================
-- Not every machine's fuel is tracked. Two cases:
--   * no engine / electric — cement silos, batching plants, tower cranes
--   * fuel not worth tracking — office vehicles (cars)
-- These still exist as tracked assets (visible on the Machinery list and
-- the Visualization board) but are kept off the daily fuel report.
-- =============================================================

alter table machines
  add column if not exists track_fuel boolean not null default true;
