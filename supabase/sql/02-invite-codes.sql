-- 02 — Create the missing `invite_codes` table.
--
-- forge-admin.html reads and writes it (select, insert, delete) using the
-- service_role key pasted in at runtime. The restored project didn't have it,
-- so the admin invite feature was broken.
--
-- Columns match what the admin page sends: code, note, used (+ id, created_at).
-- RLS is ON with NO policies on purpose: ordinary users and anonymous visitors
-- get no access at all; the service role bypasses RLS.

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  note text,
  used boolean not null default false,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;
revoke all on public.invite_codes from anon, authenticated;

-- verify
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'invite_codes' order by ordinal_position;
