-- =============================================================
-- Issue-out quantity should reflect what was actually received, not what
-- was sent, once a transfer is confirmed.
--
-- Before this fix, ISSUE_OUT always deducted qty_sent from the source,
-- regardless of what the destination confirmed. That meant:
--   - a shortage on receipt silently vanished from company-wide stock
--   - an excess on receipt created phantom stock (destination gained more
--     than the source ever lost)
-- This also contradicted stock_reconciliation's own documented assumption
-- that a matched transfer's two legs (ISSUE_OUT / RECEIVE_IN) net to zero.
--
-- New behaviour:
--   status = 'dispatched'            -> source loses qty_sent (in transit,
--                                        final count not yet confirmed)
--   status = 'received' | 'partial'  -> source loses qty_received instead,
--                                        corrected to match what the
--                                        destination actually confirmed
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
  -- transfer: stock leaves the source. While in transit the full sent
  -- quantity is deducted; once confirmed, the deduction is corrected to
  -- the actual received quantity (short or excess).
  select
    t.from_project_id,
    l.item_id,
    'ISSUE_OUT',
    case
      when t.status = 'dispatched' then -l.qty_sent
      else -coalesce(l.qty_received, l.qty_sent)
    end,
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

-- stock_balances and stock_reconciliation both select from ledger_entries
-- and need no changes — they pick up the corrected numbers automatically.
