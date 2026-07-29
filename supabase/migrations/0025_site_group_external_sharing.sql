-- Extend site groups to OPTIONALLY also share EXTERNAL (hired) machines.
-- The Dahej group is a physically-moving INTERNAL fleet — external
-- machines there stay put, by design. But some groups are really "one
-- person operates several sites end to end": they need to see, fill, AND
-- register hired machines at any site in the group, not just their own.
-- Off by default (share_external = false), so the existing Dahej group
-- is completely unaffected by this migration.

alter table site_groups add column share_external boolean not null default false;

-- Sites in my group where external sharing is switched on. Empty for a
-- group (or an ungrouped site) that hasn't opted in.
create or replace function my_shared_external_project_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id
  from projects p
  join site_groups sg on sg.id = p.group_id
  where sg.share_external
    and p.group_id = (select group_id from projects where id = my_home_project())
$$;

-- Replace the internal-only read grant with one that also covers
-- external machines once a group has opted in.
drop policy if exists "read group internal machines" on machines;
create policy "read group machines" on machines
  for select using (
    project_id in (select my_group_project_ids())
    and (
      ownership = 'internal'
      or project_id in (select my_shared_external_project_ids())
    )
  );

drop policy if exists "read group internal machine logs" on daily_logs;
create policy "read group machine logs" on daily_logs
  for select using (
    exists (
      select 1 from machines m
      where m.id = daily_logs.machine_id
        and m.project_id in (select my_group_project_ids())
        and (
          m.ownership = 'internal'
          or m.project_id in (select my_shared_external_project_ids())
        )
    )
  );

-- Register a NEW external machine at any site in my share_external
-- group — additive to the existing "at my own site" insert policy.
create policy "create external machines in shared group" on machines
  for insert with check (
    ownership = 'external' and project_id in (select my_shared_external_project_ids())
  );

-- remove_hired_machine's own-site check widened the same way, so
-- whoever can register a hired machine at a shared site can also retire
-- it there.
create or replace function remove_hired_machine(p_machine_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_project   uuid;
  v_ownership text;
begin
  select project_id, ownership into v_project, v_ownership
  from machines where id = p_machine_id;

  if v_project is null then
    raise exception 'Machine not found';
  end if;
  if v_ownership <> 'external' then
    raise exception 'Only hired (external) machines can be removed this way';
  end if;
  if not (
    is_admin()
    or v_project = my_home_project()
    or v_project in (select my_shared_external_project_ids())
  ) then
    raise exception 'Not authorized to remove this machine';
  end if;

  update machines set is_active = false where id = p_machine_id;
end;
$$;
