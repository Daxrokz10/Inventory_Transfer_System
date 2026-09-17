-- =============================================================
-- HR module — candidates, interviews, Microsoft (Excel) connection
--
-- The candidate master lives in an online Excel workbook (Microsoft 365)
-- that HR keeps using. The app syncs both ways, matching rows on the
-- "Candidate ID" column. Candidate columns are plain TEXT so values
-- round-trip exactly as typed ("3.5 LPA", "5 yrs").
--
-- Role checks compare role::text so this whole file runs in one
-- transaction even though it adds the 'hr' enum value.
-- =============================================================

alter type user_role add value if not exists 'hr';

create or replace function is_hr()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role::text in ('hr', 'admin', 'superadmin')
  );
$$;

-- ---------- candidates ----------
create table if not exists hr_candidates (
  id                  uuid primary key default gen_random_uuid(),
  candidate_code      text not null unique,
  name                text not null,
  designation         text,
  phone               text,
  current_salary      text,
  expected_salary     text,
  experience_years    text,
  industry_experience text,
  hr_remarks          text,
  job_change_reason   text,
  status              text,
  resume_url          text,
  excel_row           int,          -- 1-based sheet row; null = not in Excel yet
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  synced_at           timestamptz
);

-- ---------- interviews ----------
create table if not exists hr_interviews (
  id              uuid primary key default gen_random_uuid(),
  candidate_id    uuid not null references hr_candidates(id) on delete cascade,
  interviewer_id  uuid not null references profiles(id) on delete cascade,
  round           int not null default 1,
  scheduled_at    timestamptz,
  mode            text,             -- e.g. "In person — Head office", "Phone"
  hr_note         text,
  state           text not null default 'assigned'
                  check (state in ('assigned', 'completed', 'cancelled')),
  feedback        text,
  rating          int check (rating between 1 and 5),
  recommendation  text check (recommendation in ('hire', 'reject', 'hold', 'next_round')),
  assigned_by     uuid references auth.users(id) on delete set null,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists hr_interviews_interviewer_idx on hr_interviews (interviewer_id, state);
create index if not exists hr_interviews_candidate_idx on hr_interviews (candidate_id);

-- ---------- Microsoft connection (service role only) ----------
create table if not exists hr_ms_connection (
  id               int primary key default 1 check (id = 1),
  refresh_token    text,
  account_email    text,
  workbook_url     text,
  drive_id         text,
  item_id          text,
  sheet_name       text,
  resumes_folder_id text,
  last_synced_at   timestamptz,
  last_error       text,
  updated_at       timestamptz not null default now()
);
insert into hr_ms_connection (id) values (1) on conflict do nothing;

-- ---------- RLS ----------
alter table hr_candidates    enable row level security;
alter table hr_interviews    enable row level security;
alter table hr_ms_connection enable row level security; -- no policies: service role only

drop policy if exists "hr reads candidates" on hr_candidates;
create policy "hr reads candidates" on hr_candidates
  for select to authenticated
  using (
    is_hr()
    or exists (
      select 1 from hr_interviews i
      where i.candidate_id = hr_candidates.id and i.interviewer_id = auth.uid()
    )
  );

drop policy if exists "hr writes candidates" on hr_candidates;
create policy "hr writes candidates" on hr_candidates
  for all to authenticated
  using (is_hr()) with check (is_hr());

drop policy if exists "read own or hr interviews" on hr_interviews;
create policy "read own or hr interviews" on hr_interviews
  for select to authenticated
  using (is_hr() or interviewer_id = auth.uid());

drop policy if exists "hr manages interviews" on hr_interviews;
create policy "hr manages interviews" on hr_interviews
  for all to authenticated
  using (is_hr()) with check (is_hr());

-- Interviewers may update their own interview row (feedback). The server
-- action only ever sends feedback/rating/recommendation/state for them.
drop policy if exists "interviewer updates own interview" on hr_interviews;
create policy "interviewer updates own interview" on hr_interviews
  for update to authenticated
  using (interviewer_id = auth.uid())
  with check (interviewer_id = auth.uid());

-- ...and RLS can't restrict columns, so a trigger pins everything except the
-- feedback fields when the updater isn't HR (service role has no auth.uid()
-- and is trusted).
create or replace function hr_interviews_guard()
returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not is_hr() then
    if new.candidate_id   is distinct from old.candidate_id
    or new.interviewer_id is distinct from old.interviewer_id
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

drop trigger if exists hr_interviews_guard on hr_interviews;
create trigger hr_interviews_guard
  before update on hr_interviews
  for each row execute function hr_interviews_guard();
