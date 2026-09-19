-- An opening whose offers have all been accepted, but where not everyone has
-- joined yet: the hiring is done, the joining isn't. Shown as
-- "Completed — not yet joined"; it becomes 'filled' once they all join.

alter table hr_openings drop constraint if exists hr_openings_status_check;
alter table hr_openings
  add constraint hr_openings_status_check
  check (status in ('open', 'in_progress', 'accepted', 'filled', 'cancelled'));
