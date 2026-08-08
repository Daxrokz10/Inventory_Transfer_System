-- =============================================================
-- Manual stock adjustments (editable closing balance) + receipt-based
-- issue quantity. Both changes rewrite the same view, so they ship together.
--
-- 1) stock_adjustments
--    stock_balances is a computed view, so a quantity cannot be "set"
--    directly. Every manual correction is recorded here as a signed delta
--    and summed into the view. Append-only and auditable: who changed what,
--    from what value, to what value, when, and why.
--
-- 2) receipt-based issue quantity
--    Previously the source site was always debited qty_sent regardless of
--    what the destination confirmed, so a shortage silently vanished from
--    company-wide stock and an excess created phantom stock. Now:
--      status = 'dispatched'           -> source loses qty_sent (in transit)
--      status = 'received' | 'partial' -> source loses qty_received, so both
--                                         legs of a transfer always net to 0
--
-- NOTE: this rewrites stock_balances as defined in 0001_schema.sql.
-- 0004_ledger.sql (ledger_entries / stock_transactions) was never applied
-- to this database, so there is no ledger layer to modify.
-- =============================================================

create table if not exists stock_adjustments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects (id) on delete cascade,
  item_id       uuid not null references items (id) on delete cascade,
  -- signed: positive adds stock, negative removes it
  delta         numeric(14,2) not null,
  -- snapshot of on-hand at the time of the edit, for audit
  previous_qty  numeric(14,2),
  new_qty       numeric(14,2),
  reason        text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now()
);

create index if not exists stock_adjustments_project_item_idx
  on stock_adjustments (project_id, item_id);
create index if not exists stock_adjustments_created_at_idx
  on stock_adjustments (created_at desc);

alter table stock_adjustments enable row level security;

drop policy if exists "authed read stock_adjustments" on stock_adjustments;
create policy "authed read stock_adjustments" on stock_adjustments
  for select using (auth.uid() is not null);

-- Writes are admin-only at the database layer; the app narrows this further
-- to a two-account allowlist (see masters/projects/constants.ts).
drop policy if exists "admin writes stock_adjustments" on stock_adjustments;
create policy "admin writes stock_adjustments" on stock_adjustments
  for all using (is_admin()) with check (is_admin());

-- =============================================================
-- Final stock_balances: opening + transfers (receipt-corrected) + adjustments
-- =============================================================
create or replace view stock_balances as
with base as (
  -- opening stock
  select project_id, item_id, qty as opening, 0::numeric as out_qty, 0::numeric as in_qty
  from opening_balances

  union all
  -- outbound: full sent qty while in transit, corrected to the confirmed
  -- received qty once the destination approves
  select
    t.from_project_id,
    l.item_id,
    0,
    case
      when t.status = 'dispatched' then l.qty_sent
      else coalesce(l.qty_received, l.qty_sent)
    end,
    0
  from transfer_lines l
  join transfers t on t.id = l.transfer_id
  where t.status in ('dispatched', 'received', 'partial')

  union all
  -- inbound: arrives at destination only once confirmed
  select t.to_project_id, l.item_id, 0, 0, coalesce(l.qty_received, 0)
  from transfer_lines l
  join transfers t on t.id = l.transfer_id
  where t.status in ('received', 'partial')

  union all
  -- manual adjustments: positive counts as stock in, negative as stock out
  select
    a.project_id,
    a.item_id,
    0,
    greatest(-a.delta, 0),
    greatest(a.delta, 0)
  from stock_adjustments a
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
