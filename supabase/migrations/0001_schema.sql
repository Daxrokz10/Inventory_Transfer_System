-- =============================================================
-- Inventory Transfer System — core schema
-- Shree Ganesh Corporation
-- =============================================================

-- ---------- Enums ----------
create type user_role as enum ('admin', 'supervisor');

-- Lifecycle of a material transfer:
--   draft      -> created at sender, not yet dispatched
--   dispatched -> material left the source site (in-transit); stock removed from source
--   received   -> receiver confirmed full quantity
--   partial    -> receiver confirmed a quantity different from sent (shortage/excess flagged)
--   cancelled  -> voided before/after dispatch
create type transfer_status as enum ('draft', 'dispatched', 'received', 'partial', 'cancelled');

-- ---------- Projects (sites / jobs) ----------
create table projects (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,          -- e.g. J-0033, P-003
  name            text not null,                 -- e.g. RAJKOT DAIRY Project
  address         text,
  gstin           text,                          -- branch GSTIN used on challans
  branch          text,                          -- e.g. NAVSARI
  transporter_name text,
  transporter_id  text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------- Items (material master) ----------
create table items (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,             -- e.g. SGC-116
  description  text not null,                     -- e.g. M.S CHANNEL-100MM 20'
  unit         text not null default 'NOS',
  sub_group    text,                              -- e.g. CHANNEL
  main_group   text,                              -- e.g. SHUTTERING MATERIAL / ASSET
  hsn_code     text,                              -- for GST challan
  per_day_rate numeric(14,2) default 0,          -- rental rate
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- User profiles (extends auth.users) ----------
create table profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  full_name       text,
  role            user_role not null default 'supervisor',
  home_project_id uuid references projects (id),  -- the site this supervisor manages
  created_at      timestamptz not null default now()
);

-- ---------- Opening balances (seeded from the Stock Report) ----------
create table opening_balances (
  project_id uuid not null references projects (id) on delete cascade,
  item_id    uuid not null references items (id) on delete cascade,
  qty        numeric(14,2) not null default 0,
  primary key (project_id, item_id)
);

-- ---------- Transfers (challan header) ----------
create table transfers (
  id               uuid primary key default gen_random_uuid(),
  challan_no       text unique,                   -- e.g. SGC/DHOLERA/27
  from_project_id  uuid not null references projects (id),
  to_project_id    uuid not null references projects (id),
  status           transfer_status not null default 'draft',
  transfer_date    date not null default current_date,
  lr_no            text,
  vehicle_no       text,
  eway_bill_no     text,
  eway_bill_date   date,
  transporter_name text,
  transporter_id   text,
  remarks          text,
  created_by       uuid references auth.users (id),
  dispatched_at    timestamptz,
  received_by      uuid references auth.users (id),
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint different_projects check (from_project_id <> to_project_id)
);

-- ---------- Transfer line items ----------
create table transfer_lines (
  id           uuid primary key default gen_random_uuid(),
  transfer_id  uuid not null references transfers (id) on delete cascade,
  item_id      uuid not null references items (id),
  qty_sent     numeric(14,2) not null check (qty_sent > 0),
  qty_received numeric(14,2),                      -- filled at approval; null until received
  rate         numeric(14,2) not null default 0,
  remarks      text
);

-- ---------- Indexes ----------
create index on transfers (from_project_id);
create index on transfers (to_project_id);
create index on transfers (status);
create index on transfer_lines (transfer_id);
create index on transfer_lines (item_id);

-- =============================================================
-- Stock balance view
-- on_hand(project, item) =
--   opening
--   - quantity sent out  (once dispatched / received / partial)
--   + quantity received  (once received / partial)
-- in_transit = sent from a project that the destination hasn't confirmed yet
-- =============================================================
create or replace view stock_balances as
with base as (
  select project_id, item_id, qty as opening, 0::numeric as out_qty, 0::numeric as in_qty
  from opening_balances

  union all
  -- outbound: leaves source as soon as dispatched
  select t.from_project_id, l.item_id, 0, l.qty_sent, 0
  from transfer_lines l
  join transfers t on t.id = l.transfer_id
  where t.status in ('dispatched', 'received', 'partial')

  union all
  -- inbound: arrives at destination only once confirmed
  select t.to_project_id, l.item_id, 0, 0, coalesce(l.qty_received, 0)
  from transfer_lines l
  join transfers t on t.id = l.transfer_id
  where t.status in ('received', 'partial')
)
select
  project_id,
  item_id,
  sum(opening)  as opening_qty,
  sum(in_qty)   as received_qty,
  sum(out_qty)  as issued_qty,
  sum(opening) + sum(in_qty) - sum(out_qty) as on_hand
from base
group by project_id, item_id;
