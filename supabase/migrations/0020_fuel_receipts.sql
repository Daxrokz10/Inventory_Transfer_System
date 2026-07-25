-- Diesel received on site (a barrel arriving). This records procurement —
-- distinct from daily_logs, which records fuel *issued to machines*. Barrels
-- come at market price, so the rate is the day's API diesel price (with an
-- optional manual override for the odd case where the actual price differed).
--
-- This is a record, not a reconciliation: received liters and issued liters
-- are tracked separately and shown side by side, but the app does not force
-- them to balance.

create table fuel_receipts (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects (id) on delete cascade,
  receipt_date   date not null,
  liters         numeric(10,2) not null check (liters > 0),
  barrels        int check (barrels is null or barrels > 0),
  rate_per_liter numeric(10,2),
  total_cost     numeric(14,2),
  vendor         text,
  note           text,
  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now()
);

create index fuel_receipts_project_date_idx on fuel_receipts (project_id, receipt_date);

alter table fuel_receipts enable row level security;

-- Site store persons record and can undo their own site's receipts; admins
-- see and manage everything.
create policy "read fuel_receipts for my site" on fuel_receipts
  for select using (is_admin() or project_id = my_home_project());
create policy "insert fuel_receipts at my site" on fuel_receipts
  for insert with check (is_admin() or project_id = my_home_project());
create policy "delete fuel_receipts for my site" on fuel_receipts
  for delete using (is_admin() or project_id = my_home_project());
create policy "admin updates fuel_receipts" on fuel_receipts
  for update using (is_admin()) with check (is_admin());
