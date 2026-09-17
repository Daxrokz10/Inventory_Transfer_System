-- =============================================================
-- Module access + HR v2
--
--  * Per-user module access flags (Inventory, Diesel) and HR roles
--    (staff / interviewer / planning — any combination). Managed by the
--    superadmin from the Control Panel. Existing users keep Inventory and
--    Diesel; nobody gets HR until it is switched on.
--  * HR is no longer implied by admin: is_hr() = superadmin or hr_staff.
--  * Openings raised by planning users, linked to candidates.
--  * Stage ordering for the status page, status history, interview panels.
-- =============================================================

-- ---------- access flags ----------
alter table profiles
  add column if not exists can_inventory  boolean not null default true,
  add column if not exists can_diesel     boolean not null default true,
  add column if not exists hr_staff       boolean not null default false,
  add column if not exists hr_interviewer boolean not null default false,
  add column if not exists hr_planning    boolean not null default false;

create or replace function is_hr()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and (p.role::text = 'superadmin' or p.hr_staff)
  );
$$;

create or replace function is_hr_planning()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and (p.role::text = 'superadmin' or p.hr_planning)
  );
$$;

-- ---------- openings ----------
create table if not exists hr_openings (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,          -- OPN-0001
  designation   text not null,
  project_id    uuid references projects(id) on delete set null,
  headcount     int not null default 1 check (headcount > 0),
  required_by   date,
  experience    text,
  salary_range  text,
  description   text,
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status        text not null default 'open' check (status in ('open', 'in_progress', 'filled', 'cancelled')),
  acknowledged_at timestamptz,                 -- set when HR first opens it
  raised_by     uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table hr_openings enable row level security;

drop policy if exists "read openings" on hr_openings;
create policy "read openings" on hr_openings
  for select to authenticated
  using (is_hr() or raised_by = auth.uid());

drop policy if exists "planning raises openings" on hr_openings;
create policy "planning raises openings" on hr_openings
  for insert to authenticated
  with check (is_hr_planning() and raised_by = auth.uid());

drop policy if exists "hr manages openings" on hr_openings;
create policy "hr manages openings" on hr_openings
  for update to authenticated
  using (is_hr()) with check (is_hr());

-- ---------- candidates ----------
alter table hr_candidates
  add column if not exists opening_code text,   -- as typed in the Excel "Opening" column
  add column if not exists opening_id uuid references hr_openings(id) on delete set null,
  add column if not exists sheet_hash text;

create index if not exists hr_candidates_status_idx  on hr_candidates (status);
create index if not exists hr_candidates_opening_idx on hr_candidates (opening_id);
create index if not exists hr_candidates_name_idx    on hr_candidates (lower(name));
create index if not exists hr_candidates_phone_idx   on hr_candidates (phone);

-- Candidate counts per status for the status page (6,000+ rows: count in
-- the database, not in the app). security_invoker keeps the caller's RLS.
create or replace view hr_status_counts with (security_invoker = true) as
  select status, count(*)::int as n
  from hr_candidates
  group by status;

-- Per-opening, per-status counts. Planning users can't read candidates, so
-- the opening page reads this through the service role after checking the
-- opening belongs to them.
create or replace view hr_opening_status_counts with (security_invoker = true) as
  select opening_id, status, count(*)::int as n
  from hr_candidates
  where opening_id is not null
  group by opening_id, status;

-- ---------- stages ----------
create table if not exists hr_stages (
  name        text primary key,
  sort_order  int not null default 1000,
  kind        text not null default 'active' check (kind in ('active', 'hold', 'success', 'closed')),
  created_at  timestamptz not null default now()
);

alter table hr_stages enable row level security;

drop policy if exists "hr reads stages" on hr_stages;
create policy "hr reads stages" on hr_stages
  for select to authenticated using (true);

drop policy if exists "hr manages stages" on hr_stages;
create policy "hr manages stages" on hr_stages
  for all to authenticated using (is_hr()) with check (is_hr());

-- ---------- status history ----------
create table if not exists hr_status_history (
  id            bigint generated always as identity primary key,
  candidate_id  uuid not null references hr_candidates(id) on delete cascade,
  from_status   text,
  to_status     text,
  source        text not null check (source in ('excel', 'app')),
  changed_by    uuid references auth.users(id) on delete set null,
  changed_at    timestamptz not null default now()
);
create index if not exists hr_status_history_candidate_idx on hr_status_history (candidate_id, changed_at desc);

alter table hr_status_history enable row level security;

drop policy if exists "read status history" on hr_status_history;
create policy "read status history" on hr_status_history
  for select to authenticated
  using (
    is_hr()
    or exists (
      select 1 from hr_interviews i
      where i.candidate_id = hr_status_history.candidate_id and i.interviewer_id = auth.uid()
    )
  );

drop policy if exists "hr writes status history" on hr_status_history;
create policy "hr writes status history" on hr_status_history
  for insert to authenticated with check (is_hr());

-- ---------- interview panels ----------
alter table hr_interviews add column if not exists panel_id uuid;
update hr_interviews set panel_id = id where panel_id is null;
alter table hr_interviews alter column panel_id set not null;
alter table hr_interviews alter column panel_id set default gen_random_uuid();
create index if not exists hr_interviews_panel_idx on hr_interviews (panel_id);

-- Guard trigger: panel membership is HR's to change, not the interviewer's.
create or replace function hr_interviews_guard()
returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not is_hr() then
    if new.candidate_id   is distinct from old.candidate_id
    or new.interviewer_id is distinct from old.interviewer_id
    or new.panel_id       is distinct from old.panel_id
    or new.round          is distinct from old.round
    or new.scheduled_at   is distinct from old.scheduled_at
    or new.mode           is distinct from old.mode
    or new.hr_note        is distinct from old.hr_note
    or new.assigned_by    is distinct from old.assigned_by
    or new.state = 'cancelled' then
      raise exception 'Interviewers can only submit feedback.';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- sync lock ----------
alter table hr_ms_connection add column if not exists sync_started_at timestamptz;
