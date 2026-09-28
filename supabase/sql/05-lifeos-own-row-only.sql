-- 05 — stop signed-in users reading each other's lifeos rows.
--
-- Run AFTER 04 and AFTER the web app that uses rpc/public_profiles is deployed.
-- Older app builds (iOS 1.0 build 3, Android 1.4) still read lifeos directly:
-- after this their leaderboard shows only the user themself and friend search
-- finds nobody, until they update. Nothing crashes.
--
-- Undo (reopens the leak): create policy "Users can view all for leaderboard"
--   on lifeos for select using (auth.role() = 'authenticated');

drop policy if exists "Users can view all for leaderboard" on public.lifeos;
drop policy if exists "Users can read own data" on public.lifeos;
create policy "Users can read own data" on public.lifeos
  for select using (auth.uid() = user_id);

-- check: should list exactly one SELECT policy on lifeos, qual (auth.uid() = user_id)
select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'lifeos';
