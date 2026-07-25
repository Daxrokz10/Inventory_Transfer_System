-- Meter-broken flag on machines. A site supervisor can flag their own
-- site's machine when its odometer/hour-meter physically fails, so daily
-- reports stop expecting a real reading from it. Only an admin can clear
-- the flag once it's set (a supervisor reporting "fixed" isn't enough —
-- someone above them confirms the meter was actually reinstalled/repaired).
--
-- Enforced with a SECURITY DEFINER function rather than a table RLS policy
-- because the rule is asymmetric per-value (site scope to set true, admin
-- only to set false) — not expressible as a single USING/CHECK pair.

alter table machines add column if not exists meter_broken boolean not null default false;

create or replace function set_meter_broken(p_machine_id uuid, p_broken boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from machines where id = p_machine_id;
  if v_project_id is null then
    raise exception 'Machine not found';
  end if;

  if p_broken then
    if not (is_admin() or v_project_id = my_home_project()) then
      raise exception 'Not authorized to flag this machine';
    end if;
  else
    if not is_admin() then
      raise exception 'Only an admin can clear a broken-meter flag';
    end if;
  end if;

  update machines set meter_broken = p_broken where id = p_machine_id;
end;
$$;

grant execute on function set_meter_broken(uuid, boolean) to authenticated;
