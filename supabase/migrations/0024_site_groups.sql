-- Site groups: clusters of sites where INTERNAL machinery moves freely
-- between them (e.g. a machine fills up at one site, does a job at
-- another). Anyone at any site in the same group can see and log
-- fuel/readings for another group site's internal machines on the daily
-- report. External (hired) machines never leave their own site, so
-- they're entirely unaffected by grouping.
--
-- A daily_logs row's project_id always stays "whichever site the person
-- filing it is actually at" (their own home site) — never the machine's
-- own registered site — so the diesel register/monthly report keep
-- attributing fuel to whichever site's barrel stock actually supplied it,
-- not to wherever the machine happens to be administratively based.

create table site_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

alter table projects add column group_id uuid references site_groups(id) on delete set null;

alter table site_groups enable row level security;
create policy "authed read site groups" on site_groups
  for select using (auth.uid() is not null);
create policy "admin writes site groups" on site_groups
  for all using (is_admin()) with check (is_admin());

-- Every project sharing the caller's own project's group (their own
-- project is already covered by the existing "my own site" policies, so
-- it isn't included here). Empty when the caller has no home project or
-- their site isn't in a group — an ungrouped site behaves exactly as
-- before.
create or replace function my_group_project_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id
  from projects p
  where p.group_id is not null
    and p.group_id = (select group_id from projects where id = my_home_project())
$$;

-- machines: an internal machine anywhere in my group is visible, layered
-- on top of the existing "my own site" policy (permissive policies OR
-- together, so this only ever ADDS visibility, never removes any).
create policy "read group internal machines" on machines
  for select using (
    ownership = 'internal' and project_id in (select my_group_project_ids())
  );

-- daily_logs: likewise, so the "already reported today" lock and history
-- see entries filed by ANY group member for a shared internal machine —
-- not just the ones filed under my own site's project_id.
create policy "read group internal machine logs" on daily_logs
  for select using (
    exists (
      select 1 from machines m
      where m.id = daily_logs.machine_id
        and m.ownership = 'internal'
        and m.project_id in (select my_group_project_ids())
    )
  );
