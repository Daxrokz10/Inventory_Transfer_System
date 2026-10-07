-- =============================================================
-- Standard monthly hire rate per machine type.
--
-- Hire rates are set per TYPE, not per machine: a boom placer costs the
-- same whichever vendor supplies it, give or take 10–15% by location. So
-- instead of typing rent on every machine at registration (which is why
-- 100 of 161 hired machines had none), one rate per type is kept here and
-- applies to every hired unit of that type.
--
-- A rent entered on an individual machine (machines.monthly_rent) still
-- wins where present — that's the place for a genuinely different deal.
--
-- Read by the Planning page's utilization analysis to cost each hired
-- machine and size what releasing it would save.
-- =============================================================

create table if not exists machine_type_rates (
  machine_type  text primary key,
  monthly_rent  numeric(12,2) not null check (monthly_rent >= 0),
  updated_at    timestamptz not null default now()
);

alter table machine_type_rates enable row level security;

-- Anyone who can see the cross-site analysis (admin, superadmin, or a
-- read-only viewer) can read the rates; only an admin changes them. The
-- role is checked inline rather than via is_viewer(), so this migration
-- doesn't depend on 0043 having been applied first.
drop policy if exists "read type rates" on machine_type_rates;
create policy "read type rates" on machine_type_rates
  for select using (
    is_admin()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role::text = 'viewer'
    )
  );

drop policy if exists "admin writes type rates" on machine_type_rates;
create policy "admin writes type rates" on machine_type_rates
  for all using (is_admin()) with check (is_admin());
