-- =============================================================
-- Machine transfer history — an audit trail of which site each
-- machine has moved between, and when. Nothing recorded this
-- retroactively (there was no log before this table existed), so
-- history before this migration is reconstructed on the History page
-- from daily_logs' own project_id per date instead. Going forward,
-- every transfer through transferMachine() writes a row here, giving
-- exact from/to sites and dates rather than an inference from logs.
-- =============================================================

create table machine_transfers (
  id              uuid primary key default gen_random_uuid(),
  machine_id      uuid not null references machines (id) on delete cascade,
  from_project_id uuid references projects (id),
  to_project_id   uuid not null references projects (id),
  transferred_at  date not null default current_date,
  transferred_by  uuid references profiles (id),
  created_at      timestamptz not null default now()
);

create index machine_transfers_machine_idx on machine_transfers (machine_id, transferred_at);
create index machine_transfers_date_idx on machine_transfers (transferred_at);

alter table machine_transfers enable row level security;

-- Admin-only, same as the other cross-site reporting tables (anomaly_flags,
-- fuel_prices writes) — a supervisor has no reason to see other sites'
-- machine movements, and only an admin can transfer a machine anyway.
create policy "admin all on machine_transfers" on machine_transfers
  for all using (is_admin()) with check (is_admin());
