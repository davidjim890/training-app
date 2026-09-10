# training-app

A personal hypertrophy training tracker. Builds workout mesocycles, logs sets,
collects per-muscle recovery feedback, and uses that feedback to prescribe the
next week's volume. Inspired by the Renaissance Periodization approach.

Single user (the author). Not a product, no accounts, no backend.

## Stack

- **Vite + Svelte + TypeScript** (`svelte-ts` template)
- **Dexie.js** over IndexedDB for all persistence — local-first, no server
- **vite-plugin-pwa** for the service worker and web app manifest
- Deployed as a static site; installed to the iPhone home screen via
  Safari → Share → Add to Home Screen

## Decisions already made — do not re-litigate these

**This is a PWA, not a native app.** Native iOS was considered and rejected
because it requires Xcode (10-15GB), and permanent device installs require
either a $99/year Apple Developer account or re-signing every 7 days. A PWA
avoids all of that. Do not suggest React Native, Expo, Flutter, or Swift.

**Flutter was started and abandoned** for the reason above. Ignore any
leftover Flutter/Dart artifacts or extensions.

**Svelte over React** for bundle size and lower boilerplate. The author is new
to web development but is an experienced R programmer and statistician —
comfortable with data structures, modeling, and logic; less familiar with
JS/TS idioms and frontend conventions. Explain frontend-specific concepts;
don't over-explain programming fundamentals.

## Architecture rules

**The progression logic lives in `src/lib/progression.ts` and must stay pure.**
No database calls, no Svelte imports, no side effects — only functions that
take state and return prescriptions. This is deliberate so the training
algorithm can be unit-tested in isolation and tuned without touching UI.
Do not move this logic into components. Its behaviour is pinned by
`src/lib/progression.test.ts` (Vitest, `npm test`) — add a case whenever a
rule or constant changes.

**The data layer is Dexie only.** Components should not hold canonical state;
they read from and write to the database. Row types live in `src/db/schema.ts`
(pure types, imports domain vocabulary from the engine), the database class
and indexes in `src/db/index.ts`, JSON export/import in `src/db/backup.ts`.
Never edit a shipped `version(n).stores()` in place — add `version(n+1)` with
an `upgrade()`.

## Data model

- `exercises` — name, muscleGroup, secondaryMuscleGroup, equipment, source
  (`seed` | `custom`). **Sets count toward the primary muscle only.**
  `secondaryMuscleGroup` is a hint for the picker, never credited as volume.
  Starter library in `src/db/seed.ts`, loaded once via Dexie `populate`.
- `mesocycles` — name, numWeeks (incl. deload), daysPerWeek, startingRir,
  startDate, status
- `mesocycleDays` — the weekly template ("Push A", "Lower B")
- `mesocycleDayExercises` — planned exercises per template day, startingSets
- `sessions` — an actual instance of a template day in a given week
- `sessionExercises` — exercise slot in a session, with targetSets/targetRir
- `sets` — weight, reps, actualRir per set
- `muscleFeedback` — per session per muscle: soreness, pump, jointPain, workload
- `volumeLandmarks` — the author's personal MEV/MRV estimates per muscle group
- `cardioSessions` (schema v2) — standalone cardio log: date, kind, durationMin,
  distanceKm?, intensity (0 easy → 2 hard), notes?. Not linked to blocks and
  not an engine input.

Muscle groups are the `MUSCLE_GROUPS` array in `progression.ts`. Back is
split into lats / mid-back / traps / rear-delts; `shoulders` means front +
side delts together (trained with movements that hit both).

Feedback scales (RP convention):
- soreness (asked *before* the session): 0 never sore → 3 still sore
- pump: 0 none → 2 huge
- jointPain: 0 none → 2 real pain
- workload: 0 easy → 3 too much

## Progression rules

RIR ramps down linearly across accumulation weeks (e.g. 3, 2, 1, 0) then a
deload at roughly half volume and high RIR. Weekly set counts move up or down
per muscle group based on feedback, capped at MRV. Joint pain overrides
everything.

The exact RP algorithm is proprietary; ours is a reconstruction from publicly
described principles. **Constants are intentionally tunable guesses** — the
long-term plan is to fit them to the author's own logged data. Keep them
named and centralized, not scattered as magic numbers.

## Constraints to respect

- **Offline-first.** The app is used in a gym, possibly without signal.
  Everything must work with no network.
- **iOS Safari limits.** No HealthKit, Bluetooth, or NFC. No reliable
  background sync. Safari can evict storage under disk pressure.
- **Data export matters.** There must be an export-to-JSON path. Years of
  training data with no backup is unacceptable given the eviction risk.
- **Thumb-friendly UI.** This is used mid-set, one-handed, sweaty. Big tap
  targets, minimal typing, numeric inputs over free text.

## Deployment

- Repo: https://github.com/davidjim890/training-app (public — free GitHub
  Pages requires it; no training data is ever committed, only code).
- Live: https://davidjim890.github.io/training-app/
- `.github/workflows/deploy.yml` runs check + tests + build and publishes
  `dist/` on every push to `main`. The build sets `BASE_PATH=/training-app/`,
  which `vite.config.ts` uses for Vite's `base` and the manifest scope.
  Locally the base stays `/`.
- Install on iPhone: open the live URL in Safari → Share → Add to Home Screen.

## Current state

Feature-complete for a first real block. `dexie` and `vite-plugin-pwa` are
configured (autoUpdate service worker, manifest + icons in `public/`).
Schema is at **v2** (v1 shipped; v2 added `cardioSessions`).

- Engine (`src/lib/progression.ts`): RIR ramp, per-muscle volume rule, deload,
  load suggestion, week feedback aggregation, set distribution, MRV revision.
- Data layer (`src/db/`): schema v1, seed library, per-table repositories
  (`exercises`, `mesocycles`, `sessions`, `feedback`, `planning`, `backup`).
  `planning.planWeek` is the bridge: previous week's logged sets + feedback →
  `planNextWeek` → targets per exercise slot, with rationale. Called by
  `startSession`, so a week is planned from whatever of the prior week exists
  when its first session is created.
- UI (`src/screens/`): Home, mesocycle builder + exercise picker, Block (week
  tabs, day status, this week's per-muscle plan with rationale), Session (the
  gym screen), pre/post feedback prompts, Settings (export/import backup).
  No router — `App.svelte` holds a `screen` state value mirrored into
  browser history (so the iOS edge swipe works) plus a bottom `TabBar`
  (Train / Blocks / Cardio / Settings). Train resolves via `resolveTrainTarget`:
  in-progress session → active block → planned block → Blocks list.

Known open questions: MEV is unread (volume can drop to 0 after joint pain);
RIR ramp rounding on 4/6-week blocks; `planNextWeek` past the final week.
Not yet built: block completion + `reviseMrv`, landmark editing UI, exercise
swap within a block.

To run in a headless browser for verification: Playwright-core with
`channel: "chrome"` against the installed Google Chrome works; no browser
download needed. Desktop Chrome's Web Share refuses in headless mode, so
export falls back to a download there.
