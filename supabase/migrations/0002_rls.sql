-- =============================================================
-- Row Level Security
-- Roles:
--   admin (store head): full access to everything
--   supervisor: reads masters + balances; creates dispatches FROM their
--               home site; approves receipts TO their home site
-- =============================================================

-- Helper functions (SECURITY DEFINER so they can read profiles without
-- triggering recursive RLS checks).
create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function my_home_project()
returns uuid
language sql stable security definer set search_path = public as $$
  select home_project_id from profiles where id = auth.uid();
$$;

-- ---------- Enable RLS ----------
alter table profiles          enable row level security;
alter table projects          enable row level security;
alter table items             enable row level security;
alter table opening_balances  enable row level security;
alter table transfers         enable row level security;
alter table transfer_lines    enable row level security;

-- ---------- profiles ----------
create policy "read own or admin all" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "admin manages profiles" on profiles
  for all using (is_admin()) with check (is_admin());

-- ---------- projects (read for all authed, write admin only) ----------
create policy "authed read projects" on projects
  for select using (auth.uid() is not null);
create policy "admin writes projects" on projects
  for all using (is_admin()) with check (is_admin());

-- ---------- items ----------
create policy "authed read items" on items
  for select using (auth.uid() is not null);
create policy "admin writes items" on items
  for all using (is_admin()) with check (is_admin());

-- ---------- opening_balances ----------
create policy "authed read opening" on opening_balances
  for select using (auth.uid() is not null);
create policy "admin writes opening" on opening_balances
  for all using (is_admin()) with check (is_admin());

-- ---------- transfers ----------
-- Read any transfer that involves your site (or admin).
create policy "read transfers for my site" on transfers
  for select using (
    is_admin()
    or from_project_id = my_home_project()
    or to_project_id   = my_home_project()
  );

-- Create dispatches only FROM your own site (admin may create any).
create policy "create transfers from my site" on transfers
  for insert with check (
    is_admin() or from_project_id = my_home_project()
  );

-- Update rules: sender can edit/dispatch their own; receiver can approve
-- transfers coming to their site; admin anything.
create policy "update transfers for my site" on transfers
  for update using (
    is_admin()
    or from_project_id = my_home_project()
    or to_project_id   = my_home_project()
  ) with check (
    is_admin()
    or from_project_id = my_home_project()
    or to_project_id   = my_home_project()
  );

create policy "admin deletes transfers" on transfers
  for delete using (is_admin());

-- ---------- transfer_lines (inherit access from parent transfer) ----------
create policy "read lines for my transfers" on transfer_lines
  for select using (
    exists (
      select 1 from transfers t
      where t.id = transfer_lines.transfer_id
        and (is_admin() or t.from_project_id = my_home_project() or t.to_project_id = my_home_project())
    )
  );

create policy "write lines for my transfers" on transfer_lines
  for all using (
    exists (
      select 1 from transfers t
      where t.id = transfer_lines.transfer_id
        and (is_admin() or t.from_project_id = my_home_project() or t.to_project_id = my_home_project())
    )
  ) with check (
    exists (
      select 1 from transfers t
      where t.id = transfer_lines.transfer_id
        and (is_admin() or t.from_project_id = my_home_project() or t.to_project_id = my_home_project())
    )
  );

-- ---------- Auto-create a profile when a new auth user signs up ----------
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
