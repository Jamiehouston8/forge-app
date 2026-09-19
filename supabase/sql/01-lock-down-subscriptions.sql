-- 01 — Lock down `subscriptions`.
--
-- Found 2026-09-19: any signed-in user, and even a logged-out visitor with only
-- the public anon key, could read every subscription row (including
-- stripe_customer_id), and any user could insert their own "active" row.
--
-- The app only ever reads its OWN row (`?user_id=eq.<me>`); the Stripe
-- webhook writes with the service role, which bypasses these rules.

-- remove whatever policies exist (names are unknown; they were made by hand)
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'subscriptions'
  loop
    execute format('drop policy %I on public.subscriptions', p.policyname);
  end loop;
end $$;

alter table public.subscriptions enable row level security;

-- belt and braces: remove the underlying permissions too, so it stays safe
-- even if a permissive policy is added later by mistake
revoke all on public.subscriptions from anon;
revoke insert, update, delete on public.subscriptions from authenticated;

create policy "read own subscription"
  on public.subscriptions for select to authenticated
  using (auth.uid() = user_id);

-- optional clean-up: rows created by testing (edit the id, or delete this)
-- delete from public.subscriptions where user_id = '<test-user-uuid>';

-- verify: should list exactly one policy, "read own subscription", cmd = SELECT
select policyname, roles, cmd, qual from pg_policies
 where schemaname = 'public' and tablename = 'subscriptions';
