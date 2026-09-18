-- The job titles actually used in the candidate sheet, so openings and quick
-- add offer the same list instead of free text.

create or replace view hr_designations with (security_invoker = true) as
  select designation, count(*)::int as n
  from hr_candidates
  where designation is not null and btrim(designation) <> ''
  group by designation;
