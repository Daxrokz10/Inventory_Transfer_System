-- =============================================================
-- Which site's barrel stock a fill was drawn from.
--
-- Until now a daily_logs row's project_id did double duty: "the site
-- this machine worked for" AND "the site whose barrels supplied the
-- fuel". Inside a site group those can differ — e.g. a vehicle working
-- at P-006 (Aarti) drives over to J-0094 (Texfil) and fills from
-- Texfil's barrels, but the entry is filed by P-006's supervisor, so
-- P-006's register was debited for diesel it never issued (and Texfil's
-- register never saw it leave).
--
-- stock_project_id splits the two. Null = the filing site's own stock
-- (every existing row, and still the default); set = a sister group
-- site's stock. project_id is unchanged in meaning — the machine's usage
-- and cost stay with the site it worked for; only the barrel debit moves.
-- =============================================================

alter table daily_logs
  add column if not exists stock_project_id uuid references projects (id);

create index if not exists daily_logs_stock_project_idx
  on daily_logs (stock_project_id, log_date)
  where stock_project_id is not null;

-- The supplying site must be able to see fills drawn from its own stock
-- in its register — including for a machine it otherwise can't see
-- (e.g. an external machine in a group that doesn't share externals).
drop policy if exists "read logs drawn from my stock" on daily_logs;
create policy "read logs drawn from my stock" on daily_logs
  for select using (stock_project_id = my_home_project());

-- Keep the per-site barrel balance view in step with register.ts: a fill
-- debits coalesce(stock_project_id, project_id), not project_id.
create or replace view diesel_site_balances
with (security_invoker = true) as
select
  p.id                                  as project_id,
  coalesce(os.liters, 0)                as opening_stock,
  coalesce(r.liters, 0)                 as received_liters,
  coalesce(o.liters, 0)                 as issued_from_stock_liters,
  round(
    coalesce(os.liters, 0) + coalesce(r.liters, 0) - coalesce(o.liters, 0),
    2
  )                                     as closing_balance,
  o.last_issue_date                     as last_issue_date
from projects p
left join diesel_opening_stock os
  on os.project_id = p.id
left join (
  select project_id, sum(liters) as liters
  from fuel_receipts
  where fuel_type = 'diesel'
  group by project_id
) r on r.project_id = p.id
left join (
  select
    coalesce(dl.stock_project_id, dl.project_id) as project_id,
    sum(dl.fuel_issued_liters)                   as liters,
    max(dl.log_date)                             as last_issue_date
  from daily_logs dl
  join machines m on m.id = dl.machine_id
  where dl.fuel_issued_liters > 0
    and (dl.fuel_source is null or dl.fuel_source = 'on_site')
    and m.fuel_type = 'diesel'
  group by coalesce(dl.stock_project_id, dl.project_id)
) o on o.project_id = p.id;

grant select on diesel_site_balances to authenticated;
