-- fuel_receipts only ever recorded diesel deliveries. Sites with petrol
-- machinery (bikes, cars, mopeds) need to log petrol received too, so the
-- receipt now carries which fuel it is — defaulting existing rows to
-- 'diesel' since that's all that was ever recorded.

alter table fuel_receipts add column if not exists fuel_type text not null default 'diesel'
  check (fuel_type in ('diesel', 'petrol'));
