-- =============================================================
-- Machine lifecycle: let site staff manage their own site's machines,
-- and let a daily report record a breakdown/maintenance day instead of
-- a normal reading.
-- =============================================================

-- Supervisors manage their own site's machines: they can deactivate an
-- internal machine (history preserved, just hidden from daily use) and
-- delete an external/hired machine outright once it's returned. The app
-- enforces that supervisors only hard-delete external machines — this
-- policy just grants the underlying DB permission for own-site rows.
create policy "supervisor updates own site machines" on machines
  for update using (project_id = my_home_project())
  with check (project_id = my_home_project());

create policy "supervisor deletes own site machines" on machines
  for delete using (project_id = my_home_project());

-- A day's report can record that the machine was broken down or under
-- maintenance instead of a normal reading/fuel entry.
alter table daily_logs add column if not exists status text not null default 'normal'
  check (status in ('normal', 'breakdown', 'maintenance'));
