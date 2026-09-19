-- 03 — Remove duplicate `lifeos` rows and stop them coming back.
--
-- Why: `lifeos` has its own `id` primary key and NO unique key on `user_id`.
-- The old onboarding code did a "merge-duplicates" POST, which only merges on
-- the primary key, so every run inserted a second row for the same user. The
-- main app then reads whichever row comes back first.
--
-- The new onboarding code (deployed 2026-09-19) no longer creates duplicates,
-- but existing accounts may already have them. Run the steps ONE AT A TIME and
-- look at the output of each.

-- STEP 1 — how bad is it? (read-only)
select user_id, count(*) as row_count, max(updated_at) as newest
  from public.lifeos
 group by user_id
having count(*) > 1
 order by row_count desc;

-- STEP 2 — take a backup copy first (safe to run once)
create table if not exists public.lifeos_backup_20260919 as
  select * from public.lifeos;

-- STEP 3 — inspect one affected user before deleting anything
-- (replace the uuid with one from step 1; look at how the rows differ)
-- select id, updated_at, jsonb_object_keys(data) as key
--   from public.lifeos where user_id = '<uuid>' order by updated_at;

-- STEP 4 — delete every duplicate except the newest row per user
-- (ties broken by id). The main app PATCHes all of a user's rows together on
-- every save, so active accounts' duplicates carry the same state.
delete from public.lifeos a
using public.lifeos b
where a.user_id = b.user_id
  and (coalesce(a.updated_at, 'epoch'::timestamptz), a.id)
    < (coalesce(b.updated_at, 'epoch'::timestamptz), b.id);

-- STEP 5 — make duplicates impossible from now on
alter table public.lifeos
  add constraint lifeos_user_id_key unique (user_id);

-- STEP 6 — verify: should return no rows
select user_id, count(*) from public.lifeos group by user_id having count(*) > 1;

-- To undo the delete (step 4), restore from lifeos_backup_20260919.
