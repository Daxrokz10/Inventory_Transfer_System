-- SO (Supply Order) / deployment duration tracking.
--
-- A machine is often authorized at a site for a fixed period — a tractor
-- sanctioned for 3 months of a 12-month site, a hired machine on a rental
-- window. We record when the current deployment began and the date its
-- authorization runs out, so an overstaying machine can be flagged.
--
-- These describe the machine's CURRENT deployment at its CURRENT site, so
-- they must be reset whenever the machine is transferred (handled in the
-- transferMachine server action).

alter table machines
  add column if not exists deployed_at date,
  add column if not exists so_until date;

-- Backfill: treat existing machines as deployed since they were created,
-- with no SO deadline set (permanent until an admin sets one).
update machines
  set deployed_at = coalesce(deployed_at, created_at::date)
  where deployed_at is null;

-- ---------- Machine change requests (renewal / removal) ----------
-- Site supervisors can't extend an SO or remove a machine themselves —
-- both are admin actions. Instead they file a request here; the admin
-- approves (setting a new SO date on renewal, or taking the machine out
-- of service on removal) or rejects it. A machine that runs on past its
-- SO with no request filed is what the dashboard flags as overstaying.
create table if not exists machine_requests (
  id              uuid primary key default gen_random_uuid(),
  machine_id      uuid not null references machines (id) on delete cascade,
  project_id      uuid not null references projects (id) on delete cascade,
  type            text not null check (type in ('renewal', 'removal')),
  note            text,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  requested_by    uuid references profiles (id),
  created_at      timestamptz not null default now(),
  resolved_by     uuid references profiles (id),
  resolved_at     timestamptz,
  resolution_note text
);

-- Fast lookup of the open request(s) for a machine.
create index if not exists machine_requests_machine_idx
  on machine_requests (machine_id) where status = 'pending';
create index if not exists machine_requests_project_idx
  on machine_requests (project_id);
-- At most one open request of each type per machine.
create unique index if not exists machine_requests_one_open_idx
  on machine_requests (machine_id, type) where status = 'pending';

alter table machine_requests enable row level security;

-- Supervisors see + file requests for their own site; admins see/act on
-- all. Only admins resolve (update) a request.
create policy "read requests for my site" on machine_requests
  for select using (is_admin() or project_id = my_home_project());
create policy "create requests at my site" on machine_requests
  for insert with check (is_admin() or project_id = my_home_project());
create policy "admin resolves requests" on machine_requests
  for update using (is_admin()) with check (is_admin());
create policy "admin deletes requests" on machine_requests
  for delete using (is_admin());
