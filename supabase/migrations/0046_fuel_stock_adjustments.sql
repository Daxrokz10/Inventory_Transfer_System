-- =============================================================
-- Fuel stock adjustments — corrections to a site's barrel balance that are
-- neither a delivery nor a fill.
--
-- The register balance is opening count + deliveries − fills. When it has
-- drifted from what's physically in the barrels (e.g. a site entered the
-- BILLED litres of deliveries as received, so the deliverer's cut was
-- counted as stock), there was no honest way to correct it: deliveries
-- can't be negative, the opening count can't go below zero, and a fake
-- fill would be counted as machine consumption and cost.
--
-- An adjustment moves the BALANCE only — signed litres, a date, and a
-- mandatory reason. No cost (the fuel was already paid for at delivery),
-- no machine, no effect on consumption reports.
-- =============================================================

create table if not exists fuel_stock_adjustments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id),
  adj_date    date not null default current_date,
  fuel_type   text not null default 'diesel' check (fuel_type in ('diesel', 'petrol')),
  -- Signed: negative takes stock off, positive adds it.
  liters      numeric(10,2) not null check (liters <> 0),
  reason      text not null check (length(trim(reason)) > 0),
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now()
);

create index if not exists fuel_stock_adjustments_site_idx
  on fuel_stock_adjustments (project_id, fuel_type, adj_date);

alter table fuel_stock_adjustments enable row level security;

-- Visible to whoever can see the site's register: its own supervisor, an
-- admin, or a read-only viewer. Only an admin makes or removes one.
drop policy if exists "read adjustments for my site" on fuel_stock_adjustments;
create policy "read adjustments for my site" on fuel_stock_adjustments
  for select using (
    is_admin()
    or project_id = my_home_project()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role::text = 'viewer')
  );

drop policy if exists "admin writes adjustments" on fuel_stock_adjustments;
create policy "admin writes adjustments" on fuel_stock_adjustments
  for all using (is_admin()) with check (is_admin());

-- Keep the low-stock monitor's balance view in step with register.ts:
-- opening + diesel received + adjustments − diesel issued from this stock.
create or replace view diesel_site_balances
with (security_invoker = true) as
select
  p.id                                  as project_id,
  coalesce(os.liters, 0)                as opening_stock,
  coalesce(r.liters, 0)                 as received_liters,
  coalesce(o.liters, 0)                 as issued_from_stock_liters,
  round(
    coalesce(os.liters, 0) + coalesce(r.liters, 0) + coalesce(a.liters, 0) - coalesce(o.liters, 0),
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
  select project_id, sum(liters) as liters
  from fuel_stock_adjustments
  where fuel_type = 'diesel'
  group by project_id
) a on a.project_id = p.id
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
