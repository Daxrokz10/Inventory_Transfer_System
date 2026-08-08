-- Lets an admin flag a machine for closer scrutiny (e.g. repeated
-- anomalies, a pattern that looks off) without it meaning anything
-- formal like deactivation. Visibility/control is enforced in the app
-- layer (admin-only rendering), same as monthly_rent — no RLS change
-- needed since this is informational, not access-sensitive.
alter table machines add column if not exists flagged_suspicious boolean not null default false;
