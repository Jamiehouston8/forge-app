-- 06 — user reports (App Store guideline 1.2: a way to report other users).
--
-- The app inserts a row when someone taps Report on a leaderboard entry, friend
-- or friend request. Users can only insert their own reports and can't read any.
-- Read them in the Supabase dashboard (Table Editor → reports) or with:
--   select r.created_at, r.reason, r.details, r.reported_username, r.reported_user_id, r.reporter_id
--   from reports r where r.status = 'open' order by r.created_at desc;
-- Apple expects reports to be acted on within 24 hours: change the username,
-- or delete the account, then set status = 'done'.

create table if not exists public.reports (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  reporter_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reported_user_id  uuid not null,
  reported_username text,
  reason            text not null check (reason in ('offensive_name', 'harassment', 'cheating', 'other')),
  details           text check (char_length(details) <= 500),
  status            text not null default 'open' check (status in ('open', 'done', 'dismissed'))
);

alter table public.reports enable row level security;

drop policy if exists "Users can file reports" on public.reports;
create policy "Users can file reports" on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and reported_user_id <> auth.uid() and status = 'open');

revoke all on public.reports from anon;
grant insert on public.reports to authenticated;
