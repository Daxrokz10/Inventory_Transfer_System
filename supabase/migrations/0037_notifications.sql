-- In-app notifications (bell in the sidebar).
-- Written by the server with the service role (e.g. "new interview assigned",
-- "new opening raised"); each user can only read and mark their own.

create table if not exists notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,            -- interview_assigned, opening_raised, …
  title       text not null,
  body        text,
  link        text,                     -- in-app path opened on click
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on notifications (user_id) where read_at is null;

alter table notifications enable row level security;

drop policy if exists "read own notifications" on notifications;
create policy "read own notifications" on notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "mark own notifications read" on notifications;
create policy "mark own notifications read" on notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
