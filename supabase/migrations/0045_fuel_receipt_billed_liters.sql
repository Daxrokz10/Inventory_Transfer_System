-- =============================================================
-- Billed vs received litres on a fuel delivery.
--
-- Deliverers routinely take a few litres as their own payment: the invoice
-- says 102 L, but only 100 L ever reaches the barrel. Until now a receipt
-- carried one litres figure, so it was wrong either way:
--   * enter 102 → the register counts 2 L of stock that doesn't exist, and
--     the balance drifts upward with every delivery;
--   * enter 100 → the cost is understated by the 2 L actually paid for.
--
-- liters        = what physically went into the barrel — drives STOCK.
-- billed_liters = what the invoice charges for — drives COST.
-- Null billed_liters means "same as received" (every existing receipt, and
-- any delivery with no deduction). The gap is reported as paid-for diesel
-- that never arrived.
-- =============================================================

alter table fuel_receipts
  add column if not exists billed_liters numeric(10,2);

alter table fuel_receipts drop constraint if exists fuel_receipts_billed_not_below_received;
alter table fuel_receipts
  add constraint fuel_receipts_billed_not_below_received
  check (billed_liters is null or billed_liters >= liters);
