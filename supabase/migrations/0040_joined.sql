-- "Joined" closes a candidate: the offer was accepted and they actually turned
-- up. It ends the pipeline, so it is a success stage after Offer Accepted.

insert into hr_stages (name, sort_order, kind)
values ('Joined', 100, 'success')
on conflict (name) do update set sort_order = excluded.sort_order, kind = excluded.kind;

-- The day they joined, so it can be compared with the opening's required_by
-- date. Set when HR marks them Joined; cleared if that is undone.
alter table hr_candidates
  add column if not exists joined_on date;

create index if not exists hr_candidates_joined_on_idx on hr_candidates (joined_on);
