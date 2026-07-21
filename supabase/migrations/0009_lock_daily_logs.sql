-- =============================================================
-- One report per machine per day — no resubmission.
--
-- 0006 gave supervisors UPDATE rights on their own site's daily_logs
-- (used by the accumulation feature). That feature has been removed:
-- a machine already reported for a date is now locked for that date —
-- only admins can correct a submitted entry.
-- =============================================================

drop policy if exists "update logs at my site" on daily_logs;

create policy "admin updates logs" on daily_logs
  for update using (is_admin()) with check (is_admin());
