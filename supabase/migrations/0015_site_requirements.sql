-- Planning: upcoming machine requirements per site, so supply (a machine's
-- SO end date — when it frees up) can be matched against demand (a site
-- saying "I need 2 transit mixers from Sep to Apr"). Adding/editing
-- requirements is an admin-only ("planning department") action; the
-- recommendation itself (rent now / reassign on date X / buy) is computed
-- in the app from this table + machines.so_until + a static rent-vs-buy
-- cost table, not stored here.

create table if not exists site_requirements (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id) on delete cascade,
  machine_type text not null,
  quantity     int not null default 1 check (quantity > 0),
  needed_from  date not null,
  needed_until date, -- null = open-ended / ongoing need
  status       text not null default 'open'
                 check (status in ('open', 'fulfilled', 'cancelled')),
  note         text,
  created_by   uuid references profiles (id),
  created_at   timestamptz not null default now()
);

create index if not exists site_requirements_project_idx
  on site_requirements (project_id);
create index if not exists site_requirements_open_idx
  on site_requirements (status, needed_from) where status = 'open';

alter table site_requirements enable row level security;

-- Planning is an admin authority: only admins create/edit/resolve
-- requirements. Supervisors can see the open requirements for their own
-- site (useful context), same read pattern used elsewhere.
create policy "read requirements for my site" on site_requirements
  for select using (is_admin() or project_id = my_home_project());
create policy "admin creates requirements" on site_requirements
  for insert with check (is_admin());
create policy "admin updates requirements" on site_requirements
  for update using (is_admin()) with check (is_admin());
create policy "admin deletes requirements" on site_requirements
  for delete using (is_admin());
