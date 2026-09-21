-- =============================================================
-- "viewer" — a read-only role that sees every site's Inventory and
-- Diesel data, exactly as an admin does, but can never write anything.
--
-- Two halves, both enforced in the database so a crafted request can't
-- get around the UI:
--   1. READ: a select-only policy per data table granting is_viewer()
--      the same cross-site visibility is_admin() has. Policies are
--      permissive, so these only ever ADD visibility.
--   2. WRITE: nothing grants a viewer write access. is_admin() stays
--      false for them (admin-only policies fail), and my_home_project()
--      returns null for them, so every "…at my own site" supervisor
--      write policy fails too — no daily report, no fuel receipt, no
--      transfer, no opening stock.
-- Admin-only tooling (Users, Control Panel, HR) is untouched: those
-- gate on is_admin()/is_superadmin()/HR flags, none of which a viewer has.
-- =============================================================

alter type user_role add value if not exists 'viewer';

-- ::text rather than the enum literal, so this runs in the same session
-- the value was just added in.
create or replace function is_viewer()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p where p.id = auth.uid() and p.role::text = 'viewer'
  );
$$;

-- A viewer has a home site for reporting-line purposes, but it grants no
-- write access: every own-site write policy is written against this
-- function, so returning null closes all of them at once.
create or replace function my_home_project()
returns uuid
language sql stable security definer set search_path = public as $$
  select home_project_id from profiles
  where id = auth.uid() and role::text <> 'viewer';
$$;

-- Read-all, table by table. Skips any table not present in this database
-- (0004_ledger.sql was never applied, for instance).
do $$
declare
  t text;
  tables text[] := array[
    -- inventory
    'transfers', 'transfer_lines', 'opening_balances', 'stock_adjustments',
    'stock_transactions', 'challans',
    -- diesel
    'machines', 'daily_logs', 'fuel_receipts', 'diesel_opening_stock',
    'anomaly_flags', 'machine_requests', 'site_requirements',
    'machine_transfers', 'diesel_entries', 'diesel_ai_insights'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "viewer reads all" on %I', t);
      execute format(
        'create policy "viewer reads all" on %I for select using (is_viewer())', t
      );
    end if;
  end loop;
end $$;

-- projects, items, fuel_prices and site_groups are already readable by any
-- signed-in user, so they need nothing here. profiles is deliberately NOT
-- included: a viewer sees their own row only, never other people's.
