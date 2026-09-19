-- When an opening was filled, so the status board can keep showing openings
-- completed in the last two months. Cleared again if the opening reopens.

alter table hr_openings
  add column if not exists filled_at timestamptz;

-- Openings already filled: the last joining day, or now if nobody is recorded.
update hr_openings o
set filled_at = coalesce(
  (select max(c.joined_on)::timestamptz from hr_candidates c where c.opening_id = o.id),
  now()
)
where o.status = 'filled' and o.filled_at is null;
