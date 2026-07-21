-- =============================================================
-- Diesel module v2 — DAILY report model + state-wise fuel prices
-- Run AFTER 0005_diesel.sql.
--
-- Changes:
--   * The report is filled DAILY for every machine (not just on
--     fill-ups): opening/closing meter reading + fuel issued.
--     Opening is carried from the previous day's closing; if it
--     differs, the store person must give a reason.
--   * projects.state — which Indian state the site is in, so the
--     right petrol/diesel price applies.
--   * machines.fuel_type — diesel or petrol.
--   * fuel_prices — per-day per-state price cache filled from the
--     fuel price API (manual entry possible as fallback).
--   * diesel_entries (fill-up model) is replaced by daily_logs;
--     anomaly_flags now reference daily_logs.
-- =============================================================

alter table projects add column if not exists state text;

alter table machines
  add column if not exists fuel_type text not null default 'diesel'
    check (fuel_type in ('diesel', 'petrol'));

-- Replace the fill-up tables from 0005 (no production data yet).
drop table if exists anomaly_flags cascade;
drop table if exists diesel_entries cascade;

-- ---------- Daily machine log ----------
create table daily_logs (
  id                      uuid primary key default gen_random_uuid(),
  machine_id              uuid not null references machines (id) on delete cascade,
  project_id              uuid not null references projects (id) on delete cascade,
  log_date                date not null,
  opening_reading         numeric(14,2),
  closing_reading         numeric(14,2),
  opening_mismatch_reason text,          -- required (in app) when opening ≠ previous closing
  fuel_issued_liters      numeric(10,2) not null default 0 check (fuel_issued_liters >= 0),
  rate_per_liter          numeric(10,2), -- auto-filled from fuel_prices when available
  total_cost              numeric(14,2),
  remarks                 text,
  entered_by              uuid references profiles (id),
  created_at              timestamptz not null default now(),
  unique (machine_id, log_date),
  constraint closing_not_behind_opening
    check (
      opening_reading is null
      or closing_reading is null
      or closing_reading >= opening_reading
    )
);

create index daily_logs_project_date_idx on daily_logs (project_id, log_date);
create index daily_logs_machine_date_idx on daily_logs (machine_id, log_date);

-- ---------- Anomaly flags (now on daily logs) ----------
create table anomaly_flags (
  id         uuid primary key default gen_random_uuid(),
  log_id     uuid not null references daily_logs (id) on delete cascade,
  type       text not null,
  severity   text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  message    text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create index anomaly_flags_log_idx on anomaly_flags (log_id);

-- ---------- Fuel price cache (state-wise, per day) ----------
create table fuel_prices (
  id         uuid primary key default gen_random_uuid(),
  price_date date not null,
  state      text not null,
  fuel_type  text not null check (fuel_type in ('diesel', 'petrol')),
  price      numeric(10,2) not null check (price > 0),
  source     text not null default 'api',   -- 'api' | 'manual'
  created_at timestamptz not null default now(),
  unique (price_date, state, fuel_type)
);

-- ---------- Row Level Security ----------
alter table daily_logs  enable row level security;
alter table anomaly_flags enable row level security;
alter table fuel_prices enable row level security;

-- daily_logs: supervisors read/insert/update their own site's sheet
-- (update allowed so the day's sheet can be corrected); admin everything.
create policy "read logs for my site" on daily_logs
  for select using (is_admin() or project_id = my_home_project());
create policy "create logs at my site" on daily_logs
  for insert with check (is_admin() or project_id = my_home_project());
create policy "update logs at my site" on daily_logs
  for update using (is_admin() or project_id = my_home_project())
  with check (is_admin() or project_id = my_home_project());
create policy "admin deletes logs" on daily_logs
  for delete using (is_admin());

-- anomaly_flags
create policy "read flags for my site" on anomaly_flags
  for select using (
    is_admin()
    or exists (
      select 1 from daily_logs l
      where l.id = anomaly_flags.log_id
        and l.project_id = my_home_project()
    )
  );
create policy "admin writes flags" on anomaly_flags
  for all using (is_admin()) with check (is_admin());

-- fuel_prices: everyone signed in can read; only admin edits manually
-- (the API fetch writes via the service role, which bypasses RLS).
create policy "authed read fuel prices" on fuel_prices
  for select using (auth.uid() is not null);
create policy "admin writes fuel prices" on fuel_prices
  for all using (is_admin()) with check (is_admin());
