-- Let the site person retire a hired (external) machine themselves. Hired
-- units come and go with the work, and the store person who added one should
-- be able to remove it when the hire ends — without waiting on an admin.
--
-- "Remove" = DEACTIVATE (is_active = false), not hard-delete: the machine's
-- diesel history stays in the register and past monthly reports. Only admins
-- hard-delete. Internal machines are never removed this way.
--
-- Enforced in a SECURITY DEFINER function (like set_meter_broken) rather than
-- a broad UPDATE policy, so a supervisor can flip only is_active on only their
-- own site's external machines — not edit arbitrary fields.

create or replace function remove_hired_machine(p_machine_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_project   uuid;
  v_ownership text;
begin
  select project_id, ownership into v_project, v_ownership
  from machines where id = p_machine_id;

  if v_project is null then
    raise exception 'Machine not found';
  end if;
  if v_ownership <> 'external' then
    raise exception 'Only hired (external) machines can be removed this way';
  end if;
  if not (is_admin() or v_project = my_home_project()) then
    raise exception 'Not authorized to remove this machine';
  end if;

  update machines set is_active = false where id = p_machine_id;
end;
$$;

grant execute on function remove_hired_machine(uuid) to authenticated;
