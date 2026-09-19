# Forge

A personal operating system with an AI mentor. Goals broken into daily actions,
progression mechanics, and a coach that reads your recent state and answers with one
specific critique and one next action.

Live at **[forge-app.co.uk](https://forge-app.co.uk)**. Also a Play Store build via Capacitor.

Full write-up — architecture, the decisions behind it, and what I'd change:
**[the case study](https://github.com/jamiehouston8/jamie-portfolio/blob/master/case-study-forge.html)**
(rendered on [the portfolio site](https://jamie-houston-portfolio.netlify.app)).

## Status

My own daily driver. **No external users yet** — opening it up is the current focus.

## Stack

| | |
|---|---|
| UI | vanilla JS, a ~15-line `h()` hyperscript helper — no framework, no build step |
| Data / auth | Supabase (Postgres + Auth, JWT), anon key + row-level security |
| AI | Claude, called via a Supabase **edge function** (`claude-proxy`) so the API key stays server-side |
| Offline | `localStorage` write-through cache + a service worker |
| Mobile | Capacitor wrapper, Android release |
| Hosting | Netlify |

## Layout

```
www/
  index.html            landing page
  forges.html           the app (single file, ~6k lines)
  forge-onboarding.html  onboarding flow
  forge-admin.html       admin dashboard (paste service_role key at runtime)
  privacy.html
  manifest.json  sw.js
android/                Capacitor Android project
capacitor.config.json
```

## Known work

- Add an eval harness for the mentor; give it memory + the ability to act in the app.
- Add analytics / error tracking — there is none today.
- Audit the Supabase access rules before onboarding real users.
- Split the 6k-line `forges.html` into native ES modules.
