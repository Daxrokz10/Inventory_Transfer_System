-- The Own vs Rent panel (planning.ts) used to run off a hand-transcribed
-- snapshot of one spreadsheet (June 2026) — it never moved when a machine
-- was hired, returned, or re-vendored. To make it live, each external
-- (hired) machine now carries its own monthly rent, so the panel can sum
-- straight off the machines register instead of a frozen table.

alter table machines add column if not exists monthly_rent numeric(12, 2);
