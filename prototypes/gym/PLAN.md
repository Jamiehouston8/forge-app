# Forge 2.0: Gym section, release 1 November 2026

The gym section is being built as a standalone prototype (this folder) first,
then merged into `www/forges.html` as a new **Gym** page.

Run the prototype:

```
cd forge-app
python -m http.server 8790
```

Open http://127.0.0.1:8790/prototypes/gym/. Settings (⚙) → "Load 5 weeks of demo data" to see
ranks, the body map and the coach with data in them. `#demo,body` in the URL
does the same and opens a tab.

## What's in the prototype (v0.1, 27 Sep)

- **Train**: templates (Push / Pull / Legs / Upper / Lower / Full Body) or empty
  workout; log kg × reps per set; "last time" column; rest timer; PR detection;
  XP (5 per set, 25 per PR, 20 for finishing).
- **Coach**: rule-based. Double progression (8–12 reps) per exercise, plus a
  "what to train next" suggestion from this week's volume.
- **Body map**: front + back, coloured by belt rank or by sets this week. Tap a
  muscle for details.
- **Ranks**: belt per muscle group (White → Black), from estimated 1-rep max ÷
  bodyweight against per-lift standards (`exercises.js`). Overall gym belt.
- **History**: past workouts, tap to expand.
- **Recovery** (added 27 Sep, replaces the Health page in 2.0): one-tap sleep hours with a 7-night chart, water glasses, bodyweight weigh-ins with a trend line (feeds belt ranks). Writes sleep/water into Forge's `state.health` so the home screen + mentor keep working. Steps/calories dropped for now → Apple Health / Health Connect sync after 2.0; a food database only if nutrition becomes a priority.

Data lives in localStorage under `forge_gym_v1`, shaped as it will be in `state.gym`.

## Timeline

| Week | Dates | Goal |
|---|---|---|
| 1 | 28 Sep – 4 Oct | Jamie uses the prototype at the gym; collect feedback. Fix anything that feels slow mid-set. |
| 2 | 5 – 11 Oct | Prototype v0.2: per-exercise progress charts, edit/delete finished workouts, custom exercises, save own templates, plate calculator (maybe). |
| 3 | 12 – 18 Oct | **Integrate** into `forges.html`: new Gym page, `state.gym` synced via Supabase, gym XP feeds the main Forge level, the AI mentor gets gym data and can suggest the next session. |
| 4 | 19 – 25 Oct | Shareable belt-up / PR cards (self-promo); compare ranks with friends; polish; test on a real Android phone. |
| 5 | 26 Oct – 1 Nov | **Release.** Submit iOS 2.0 to Apple by **27 Oct** (review takes 1–2 days). Android 2.0 (versionCode 6) to Play. New store screenshots, TikTok launch posts. |

## Open questions

- Do strength standards feel right? (`std` in `exercises.js`: tune after real use.)
- Does gym XP go 1:1 into the main Forge XP, or is it scaled?
- Is the Gym section free, or part of the paid tier? (Payments decision still open.)
- Liftoff is the inspiration for ranks and the body map. Copy the ideas, never its name, artwork or look.
