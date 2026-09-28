-- 04 — public profile function for the leaderboard and friends.
--
-- The leaderboard, friend search, friend cards and friend profiles used to read
-- other users' whole `lifeos.data` blob (journal, mentor chat, health, goals...).
-- This function returns only the fields those screens show. Safe to run any time:
-- it adds a function and changes nothing else. Run 05 after the new app is live.
--
-- Called from the app as GET /rest/v1/rpc/public_profiles, filterable like a
-- table, e.g. ?username=eq.jamie%230001 or ?user_id=eq.<uuid>.

create or replace function public.public_profiles()
returns table (
  user_id       uuid,
  username      text,
  is_private    boolean,
  xp            integer,
  streak        integer,
  best_streak   integer,
  goals_done    integer,
  nonneg_done   integer,
  longterm_done integer,
  interests     text[],
  updated_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    -- lifeos can hold duplicate rows per user (see 03); use the newest one
    select distinct on (l.user_id) l.user_id, l.data, l.updated_at
    from lifeos l
    order by l.user_id, l.updated_at desc nulls last
  ),
  num as (
    select
      user_id, data, updated_at,
      coalesce(data->>'private', '') = 'true' as priv,
      case when jsonb_typeof(data->'xp') = 'number' then (data->>'xp')::numeric else 0 end as xp_n,
      case when jsonb_typeof(data->'streakData'->'current') = 'number' then (data->'streakData'->>'current')::numeric
           when jsonb_typeof(data->'streak') = 'number' then (data->>'streak')::numeric else 0 end as streak_n,
      case when jsonb_typeof(data->'streakData'->'best') = 'number' then (data->'streakData'->>'best')::numeric else 0 end as best_n
    from latest
  )
  select
    n.user_id,
    -- only characters that are safe in HTML (the app cleans names too)
    left(regexp_replace(coalesce(n.data->>'username', n.data->'profile'->>'username', n.data->'profile'->>'name', ''), '[^[:alnum:]#_ .-]', '', 'g'), 30) as username,
    n.priv as is_private,
    floor(n.xp_n)::integer as xp,
    floor(n.streak_n)::integer as streak,
    floor(n.best_n)::integer as best_streak,
    (select count(*)::integer from jsonb_array_elements(case when jsonb_typeof(n.data->'goals') = 'array' then n.data->'goals' else '[]'::jsonb end) g
      where g->>'done' = 'true' and coalesce(g->>'label', '') <> '') as goals_done,
    (select count(*)::integer from jsonb_array_elements(case when jsonb_typeof(n.data->'nonneg') = 'array' then n.data->'nonneg' else '[]'::jsonb end) g
      where g->>'done' = 'true' and coalesce(g->>'label', '') <> '') as nonneg_done,
    (select count(*)::integer from jsonb_array_elements(case when jsonb_typeof(n.data->'longterm') = 'array' then n.data->'longterm' else '[]'::jsonb end) g
      where g->>'done' = 'true' and coalesce(g->>'label', '') <> '') as longterm_done,
    case when n.priv then null else array(
      select left(regexp_replace(e.key, '[^[:alnum:]#_ .-]', '', 'g'), 30) from jsonb_each(case when jsonb_typeof(n.data->'interests') = 'object' then n.data->'interests' else '{}'::jsonb end) e
      where e.value not in ('false'::jsonb, 'null'::jsonb, '""'::jsonb, '0'::jsonb)
      limit 6) end as interests,
    n.updated_at
  from num n
  where auth.role() = 'authenticated'
$$;

revoke all on function public.public_profiles() from public, anon;
grant execute on function public.public_profiles() to authenticated;
