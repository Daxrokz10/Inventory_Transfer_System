-- =============================================================
-- Unified stock ledger
-- Adds a single signed-quantity ledger table for movements that are NOT
-- inter-site transfers (purchases, adjustments, and the imported Excel
-- history), then rebuilds stock_balances so closing balance is always
--   closing(item, site) = opening + SUM(signed_qty of every movement)
-- Transfers keep their own atomic two-leg table; a unifying ledger_entries
-- view normalises everything into one signed stream.
-- =============================================================

-- OPENING is included for completeness; imported/manual rows use the others.
create type txn_type as enum
  ('OPENING', 'PURCHASE', 'ISSUE_OUT', 'RECEIVE_IN', 'ADJUSTMENT');

create table stock_transactions (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references projects (id) on delete cascade,
  item_id                  uuid not null references items (id) on delete cascade,
  txn_type                 txn_type not null,
  -- one explicit signed number: positive = stock in, negative = stock out
  signed_qty               numeric(14,2) not null,
  rate                     numeric(14,2) not null default 0,
  amount                   numeric(16,2) generated always as (signed_qty * rate) stored,
  doc_date                 date,
  fiscal_year              text,
  counterparty_project_id  uuid references projects (id),
  received_from            text,
  issued_to                text,
  transfer_id              uuid references transfers (id) on delete set null,
  source                   text not null default 'manual',  -- manual | excel-import | transfer
  remarks                  text,
  created_by               uuid references auth.users (id),
  created_at               timestamptz not null default now()
);

create index on stock_transactions (project_id, item_id);
create index on stock_transactions (item_id);
create index on stock_transactions (txn_type);
create index on stock_transactions (doc_date);
create index on stock_transactions (source);

-- ---------- RLS: read for any authed user, writes admin-only ----------
alter table stock_transactions enable row level security;

create policy "authed read stock_txns" on stock_transactions
  for select using (auth.uid() is not null);
create policy "admin writes stock_txns" on stock_transactions
  for all using (is_admin()) with check (is_admin());

-- =============================================================
-- ledger_entries: one normalised signed stream across every source.
-- =============================================================
create or replace view ledger_entries as
  -- opening balances
  select
    ob.project_id,
    ob.item_id,
    'OPENING'::text          as entry_type,
    ob.qty                   as signed_qty,
    null::date               as doc_date,
    null::uuid               as counterparty_project_id,
    null::uuid               as transfer_id,
    'opening'::text          as source,
    null::text               as reference
  from opening_balances ob
  where ob.qty <> 0

  union all
  -- transfer: stock leaves the source the moment it is dispatched
  select
    t.from_project_id,
    l.item_id,
    'ISSUE_OUT',
    -l.qty_sent,
    t.transfer_date,
    t.to_project_id,
    t.id,
    'transfer',
    t.challan_no
  from transfer_lines l
  join transfers t on t.id = l.transfer_id
  where t.status in ('dispatched', 'received', 'partial')

  union all
  -- transfer: stock arrives at destination only once the receiver confirms
  select
    t.to_project_id,
    l.item_id,
    'RECEIVE_IN',
    coalesce(l.qty_received, 0),
    t.transfer_date,
    t.from_project_id,
    t.id,
    'transfer',
    t.challan_no
  from transfer_lines l
  join transfers t on t.id = l.transfer_id
  where t.status in ('received', 'partial')

  union all
  -- standalone ledger rows (purchases, adjustments, imported Excel history)
  select
    st.project_id,
    st.item_id,
    st.txn_type::text,
    st.signed_qty,
    st.doc_date,
    st.counterparty_project_id,
    st.transfer_id,
    st.source,
    st.remarks
  from stock_transactions st;

-- =============================================================
-- stock_balances rebuilt from the unified ledger (same output columns).
-- =============================================================
create or replace view stock_balances as
select
  project_id,
  item_id,
  coalesce(sum(signed_qty) filter (where entry_type = 'OPENING'), 0)                       as opening_qty,
  coalesce(sum(signed_qty) filter (where entry_type <> 'OPENING' and signed_qty > 0), 0)   as received_qty,
  coalesce(-sum(signed_qty) filter (where signed_qty < 0), 0)                              as issued_qty,
  coalesce(sum(signed_qty), 0)                                                             as on_hand
from ledger_entries
group by project_id, item_id;

-- =============================================================
-- Reconciliation: company-wide conservation per item.
-- For any item, closing across all sites must equal opening across all sites
-- plus net external movement (purchases in − adjustments etc). Inter-site
-- transfers net to zero, so a non-zero "unexplained" flags a broken leg.
-- =============================================================
create or replace view stock_reconciliation as
with per_item as (
  select
    item_id,
    sum(signed_qty) filter (where entry_type = 'OPENING')                          as opening_total,
    sum(signed_qty) filter (where source = 'transfer')                             as transfer_net,
    sum(signed_qty) filter (where entry_type = 'PURCHASE')                         as purchases,
    sum(signed_qty) filter (where entry_type = 'ADJUSTMENT')                       as adjustments,
    sum(signed_qty)                                                                as closing_total
  from ledger_entries
  group by item_id
)
select
  item_id,
  coalesce(opening_total, 0)  as opening_total,
  coalesce(purchases, 0)      as purchases,
  coalesce(adjustments, 0)    as adjustments,
  coalesce(transfer_net, 0)   as transfer_net,   -- should be ~0 if legs balance
  coalesce(closing_total, 0)  as closing_total,
  -- variance that transfers alone cannot explain (transfer_net should be 0)
  coalesce(transfer_net, 0)   as unbalanced_transfer_qty
from per_item;
