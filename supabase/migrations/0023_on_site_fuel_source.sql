-- Generalize fuel_source beyond the two Shraddha-pump sites: every site now
-- distinguishes a fill drawn from the site's own barrel stock ('on_site',
-- the default) from one where the vehicle drove out and filled at a pump
-- not tied to the site's stock ('outside'). The Shraddha sites keep their
-- existing 'shraddha' value (their normal, on-site-like source) alongside
-- 'outside' for their own exception case — unchanged from before.
--
-- Why this matters for the register: 'on_site' and legacy null fills are
-- drawn from delivered barrels, so they reduce the running balance.
-- 'shraddha' and 'outside' fills never touched this site's own barrel stock,
-- so they must NOT reduce it — see register.ts.

alter table daily_logs drop constraint if exists daily_logs_fuel_source_check;
alter table daily_logs
  add constraint daily_logs_fuel_source_check
  check (fuel_source is null or fuel_source in ('on_site', 'shraddha', 'outside'));
