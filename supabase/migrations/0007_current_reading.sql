-- =============================================================
-- Track a persistent "current reading" per machine, independent of
-- which day's report last touched it. This is the single source of
-- truth for "what does the odometer/hour-meter read right now" and
-- is what the next daily report's opening reading is compared against
-- — whether that's tomorrow, or a second entry logged later today.
-- =============================================================

alter table machines add column if not exists current_reading numeric(14,2);
alter table machines add column if not exists current_reading_at timestamptz;

-- Backfill from the latest logged closing reading per machine, if any.
update machines m
set current_reading = sub.closing_reading,
    current_reading_at = sub.created_at
from (
  select distinct on (machine_id) machine_id, closing_reading, created_at
  from daily_logs
  where closing_reading is not null
  order by machine_id, log_date desc, created_at desc
) sub
where sub.machine_id = m.id;
