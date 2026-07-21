-- =============================================================
-- Diesel Report module — machines, fill-up entries, anomaly flags
-- Shree Ganesh Corporation
--
-- Additive to the existing inventory schema. Reuses (does NOT touch):
--   profiles, projects, is_admin(), my_home_project()
--
-- NOTE: the first statement drops the draft diesel tables from the
-- earlier standalone Diesel Report app (vehicles/diesel_entries/
-- anomaly_flags). Those were created yesterday and hold no real data.
-- If you never ran that draft SQL, the drops are no-ops.
-- =============================================================

drop table if exists anomaly_flags cascade;
drop table if exists diesel_entries cascade;
drop table if exists vehicles cascade;

-- ---------- Machines (vehicles, DG sets, excavators, ...) ----------
-- Supervisors register the machinery working at their own site.
-- ownership: 'internal' = company-owned, 'external' = hired/rented
-- (external machines must carry the vendor's name).
create table machines (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects (id) on delete cascade,
  name                 text not null,                  -- e.g. "JCB 3DX", "DG Set 125kVA"
  machine_type         text not null,                  -- e.g. Excavator / JCB / DG Set / Truck
  registration_no      text,                           -- numberplate; null for DG sets etc.
  reading_type         text not null check (reading_type in ('km', 'hours')),
  ownership            text not null check (ownership in ('internal', 'external')),
  vendor_name          text,
  tank_capacity_liters numeric(10,2),
  is_active            boolean not null default true,
  created_by           uuid references profiles (id),
  created_at           timestamptz not null default now(),
  constraint external_needs_vendor
    check (ownership <> 'external' or vendor_name is not null)
);

-- Same numberplate can't be registered twice at one site.
create unique index machines_project_reg_idx
  on machines (project_id, registration_no)
  where registration_no is not null;

-- ---------- Diesel fill-up entries ----------
-- `reading` is the meter value at fill time: odometer km for reading_type
-- 'km', running hours for 'hours'.
create table diesel_entries (
  id             uuid primary key default gen_random_uuid(),
  machine_id     uuid not null references machines (id) on delete cascade,
  project_id     uuid not null references projects (id) on delete cascade,
  entered_by     uuid references profiles (id),
  entry_date     date not null,
  reading        numeric(14,2),
  liters_filled  numeric(10,2) not null check (liters_filled > 0),
  rate_per_liter numeric(10,2),
  total_cost     numeric(14,2),
  notes          text,
  created_at     timestamptz not null default now()
);

create index diesel_entries_machine_date_idx
  on diesel_entries (machine_id, entry_date);
create index diesel_entries_project_idx
  on diesel_entries (project_id);

-- ---------- Anomaly flags (rule-based checks on each entry) ----------
create table anomaly_flags (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references diesel_entries (id) on delete cascade,
  type       text not null,
  severity   text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  message    text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create index anomaly_flags_entry_idx on anomaly_flags (entry_id);

-- ---------- Row Level Security ----------
-- Mirrors the transfers pattern: admin/superadmin everywhere,
-- supervisors scoped to their home project.

alter table machines       enable row level security;
alter table diesel_entries enable row level security;
alter table anomaly_flags  enable row level security;

-- machines: supervisors may register machines AT THEIR OWN SITE;
-- edits/deactivation stay admin-only.
create policy "read machines for my site" on machines
  for select using (is_admin() or project_id = my_home_project());
create policy "create machines at my site" on machines
  for insert with check (is_admin() or project_id = my_home_project());
create policy "admin updates machines" on machines
  for update using (is_admin()) with check (is_admin());
create policy "admin deletes machines" on machines
  for delete using (is_admin());

-- diesel_entries
create policy "read entries for my site" on diesel_entries
  for select using (is_admin() or project_id = my_home_project());
create policy "create entries at my site" on diesel_entries
  for insert with check (is_admin() or project_id = my_home_project());
create policy "admin updates entries" on diesel_entries
  for update using (is_admin()) with check (is_admin());
create policy "admin deletes entries" on diesel_entries
  for delete using (is_admin());

-- anomaly_flags: visible for your site's entries; only admin resolves.
create policy "read flags for my site" on anomaly_flags
  for select using (
    is_admin()
    or exists (
      select 1 from diesel_entries e
      where e.id = anomaly_flags.entry_id
        and e.project_id = my_home_project()
    )
  );
create policy "admin writes flags" on anomaly_flags
  for all using (is_admin()) with check (is_admin());
