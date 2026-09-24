-- An interviewer should be able to read the other evaluations for a candidate
-- they are interviewing: what the earlier round said, and what the other people
-- on their own panel wrote. They still can only WRITE their own row (the
-- hr_interviews_guard trigger and the update policy see to that).
--
-- The check has to run in a function: a policy on hr_interviews that queries
-- hr_interviews would apply itself again and recurse. security definer reads
-- past RLS; it only ever answers "is this user interviewing this candidate".

create or replace function interviews_candidate(cand uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from hr_interviews i
    where i.candidate_id = cand
      and i.interviewer_id = auth.uid()
      and i.state <> 'cancelled'
  );
$$;

revoke all on function interviews_candidate(uuid) from public;
grant execute on function interviews_candidate(uuid) to authenticated;

drop policy if exists "read own or hr interviews" on hr_interviews;
create policy "read own or hr interviews" on hr_interviews
  for select to authenticated
  using (is_hr() or interviewer_id = auth.uid() or interviews_candidate(candidate_id));
