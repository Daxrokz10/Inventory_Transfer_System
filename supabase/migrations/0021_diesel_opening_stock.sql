-- One-time opening barrel-stock count per site, so the diesel register's
-- running balance is anchored. Without this the balance would start at zero
-- and go negative the moment a machine draws from barrels that arrived
-- before go-live. `as_of` is the date the count was taken; the running
-- balance from that date on = opening + inward − outward.
--
-- One row per site (the latest count wins). Set by the site person or an
-- admin at go-live, and re-settable if a fresh physical count is taken.

create table diesel_opening_stock (
  project_id uuid primary key references projects (id) on delete cascade,
  liters     numeric(12,2) not null default 0 check (liters >= 0),
  as_of      date not null,
  note       text,
  set_by     uuid references profiles (id),
  updated_at timestamptz not null default now()
);

alter table diesel_opening_stock enable row level security;

create policy "read opening stock for my site" on diesel_opening_stock
  for select using (is_admin() or project_id = my_home_project());
create policy "upsert opening stock for my site" on diesel_opening_stock
  for insert with check (is_admin() or project_id = my_home_project());
create policy "update opening stock for my site" on diesel_opening_stock
  for update using (is_admin() or project_id = my_home_project())
  with check (is_admin() or project_id = my_home_project());
create policy "delete opening stock admin" on diesel_opening_stock
  for delete using (is_admin());
