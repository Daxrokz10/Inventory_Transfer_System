-- Daily automated diesel review.
--
-- Two things live here:
--
--   1. diesel_ai_insights — findings from the once-daily review cron. A new
--      table rather than more rows in anomaly_flags, because an insight is
--      aggregate (a 14-day pattern, a site's whole balance, a month's spend)
--      and has no single daily_logs row to hang off, which anomaly_flags.log_id
--      requires.
--
--   2. diesel_site_balances — per-site barrel balance in one query. The cron's
--      low-balance check needs this for every site; doing it in the app would
--      mean running buildDieselRegister 100+ times, each of which walks that
--      site's entire history.
--
-- Apply in the Supabase SQL editor. Written to be safely re-runnable, and to
-- cope with a stale diesel_ai_insights table left behind by the earlier
-- version of this feature that was reverted: the migration file was deleted
-- but the table it had already created was not, so "create table if not
-- exists" silently skips and the unique constraint below would never appear.
-- Hence the separate create-unique-index, and the drop-policy-if-exists lines.

-- ---------- Insights ----------
create table if not exists diesel_ai_insights (
  id         uuid primary key default gen_random_uuid(),
  run_date   date not null,
  project_id uuid references projects (id) on delete cascade,
  category   text not null,
  severity   text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  -- Always populated by the rule that raised it. The LLM may rewrite it into
  -- a cleaner sentence afterwards, but never creates it — so a review that
  -- ran while the model was offline still produces complete rows.
  message    text not null,
  -- The numbers the rule actually saw, so a finding can be audited later
  -- without re-deriving it.
  raw_facts  jsonb not null default '{}'::jsonb,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);

-- One finding per category per site per run: makes the cron idempotent, so a
-- retry or a manual re-run corrects rather than duplicates. Declared as its own
-- index rather than an inline "unique (...)" so it is still created when the
-- table above already existed — the route's upsert targets these columns and
-- fails outright without a matching unique index.
create unique index if not exists diesel_ai_insights_run_site_category_key
  on diesel_ai_insights (run_date, project_id, category);

create index if not exists diesel_ai_insights_open_idx
  on diesel_ai_insights (acknowledged, run_date desc);

alter table diesel_ai_insights enable row level security;

-- Admin-only, both directions — these are cross-site management findings,
-- not a site's own record. The cron writes via the service role, which
-- bypasses RLS entirely.
drop policy if exists "admin reads insights" on diesel_ai_insights;
create policy "admin reads insights" on diesel_ai_insights
  for select using (is_admin());
drop policy if exists "admin writes insights" on diesel_ai_insights;
create policy "admin writes insights" on diesel_ai_insights
  for all using (is_admin()) with check (is_admin());

-- ---------- Per-site barrel balance ----------
-- MUST stay in step with buildDieselRegister() in src/lib/diesel/register.ts.
-- The rule, identically: opening count + all diesel received − diesel issued
-- from this site's own stock. Deliberately mirrored quirks:
--   * diesel only — a petrol receipt or a petrol machine's fill is a separate
--     stock and would silently inflate this balance;
--   * fuel_source null or 'on_site' only — a 'shraddha'/'outside' fill never
--     touched this site's barrels ('shraddha' is legacy, no longer written);
--   * diesel_opening_stock.as_of is NOT used as a cutoff, matching the app:
--     the opening count anchors the balance, it doesn't slice history.
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
    dl.project_id,
    sum(dl.fuel_issued_liters) as liters,
    max(dl.log_date)           as last_issue_date
  from daily_logs dl
  join machines m on m.id = dl.machine_id
  where dl.fuel_issued_liters > 0
    and (dl.fuel_source is null or dl.fuel_source = 'on_site')
    and m.fuel_type = 'diesel'
  group by dl.project_id
) o on o.project_id = p.id;

-- security_invoker means the caller's RLS on projects/daily_logs/fuel_receipts
-- still applies, so a supervisor reading this view only ever sees their own
-- site's row.
grant select on diesel_site_balances to authenticated;
