-- The paper "Technical Interview Evaluation Form", filled in the app.
--
-- Per-skill 1-5 scores live on the interview row as jsonb keyed by the skill
-- ids in src/lib/hr/evaluation.ts. The HR section at the bottom of the form
-- (offered salary, DOJ, comments) belongs to the candidate, not one round.

alter table hr_interviews
  add column if not exists scores       jsonb,
  add column if not exists draft_saved_at timestamptz;

alter table hr_candidates
  add column if not exists offered_salary text,
  add column if not exists date_of_joining text,
  add column if not exists hr_comments    text;

-- Interviewers save their in-progress form (scores/remarks) before submitting;
-- the guard trigger must allow those columns for them.
create or replace function hr_interviews_guard()
returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not is_hr() then
    if new.candidate_id   is distinct from old.candidate_id
    or new.interviewer_id is distinct from old.interviewer_id
    or new.panel_id       is distinct from old.panel_id
    or new.round          is distinct from old.round
    or new.scheduled_at   is distinct from old.scheduled_at
    or new.mode           is distinct from old.mode
    or new.hr_note        is distinct from old.hr_note
    or new.assigned_by    is distinct from old.assigned_by
    or new.state = 'cancelled' then
      raise exception 'Interviewers can only fill in their evaluation.';
    end if;
  end if;
  return new;
end;
$$;
