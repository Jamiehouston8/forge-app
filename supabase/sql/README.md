# Forge database scripts

These are **one-off scripts to paste into the Supabase SQL Editor** for the
Forge project (`qkcnyoiaujhxbnszrbmw`, on the `gmzozix@gmail.com` account).
Check the project ref in the dashboard URL before running anything — the same
Supabase login can have several projects.

They exist because the original schema was created by hand in the dashboard
and was never checked in. Run in this order:

| # | File | What it does | Risk |
|---|---|---|---|
| 1 | `01-lock-down-subscriptions.sql` | Stops anyone (including logged-out visitors) reading or writing other people's subscription records | Low |
| 2 | `02-invite-codes.sql` | Creates the missing `invite_codes` table the admin page uses | Low |
| 3 | `03-lifeos-dedupe.sql` | Removes duplicate `lifeos` rows and adds a uniqueness rule | Medium — takes a backup first; review the duplicate list before deleting |

After running #1, the re-test is: as a signed-in user, `GET /rest/v1/subscriptions`
should return 0 rows, the same call with only the anon key should return 0 rows,
and `POST /rest/v1/subscriptions` should be refused.

## Known design notes

- `lifeos` is readable by any signed-in user **on purpose** (leaderboard and
  friends read other users' rows). That exposes each user's whole `data` blob,
  not just their score. A `public_profiles` table would be the tidy fix.
- The paywall is client-side only: `forges.html?onboarded=1` marks an account
  onboarded, and `checkSubscription()` is defined but not used to gate access.
  Enforcing it properly means checking `subscriptions` server-side.
