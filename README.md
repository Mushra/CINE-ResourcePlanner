# Cinematic Resource Planner

A planning tool for a Cinematic Production/Tech team to manage **resource capacity** across
projects — disciplines/pools measured in FTE, not individual named people. It answers: *do we
have enough capacity for what's coming, and where exactly will we run out?*

Runs entirely locally in the browser (no server, no account) via `npm run dev`. The plan is
stored as a real SQLite file; nothing leaves the machine unless you export or save a `.sqlite`
file yourself.

## Install & run

```
npm install
npm run dev       # http://localhost:5173, opens with a seeded demo plan
npm test          # calculation engine unit tests (vitest)
npm run build     # type-check + production build to dist/
```

First launch seeds a demo plan (5 projects, 5 disciplines) so the app is immediately explorable.
Use **File menu (⋯) → New empty plan** to start from scratch, or **New demo plan** to reset the
demo data at any time.

## Architecture

```
src/
  domain/      Plain types (Project, ResourcePool, Requirement, Assignment, …) + period utilities.
               No logic — just shapes and the "YYYY-MM" period helpers.
  engine/      PlanningEngine, validation (sanity checks), forecast — pure functions/classes
               over a PlanningData snapshot. No DB or UI imports. This is what tests/ exercises.
  db/          schema.sql, database.ts (sql.js wrapper), repository.ts (typed CRUD), seed.ts.
  persistence/ IndexedDB autosave + File System Access API (New/Open/Save/Backup) with a
               download/upload fallback for browsers without that API.
  export/      exceljs workbook builder (4-sheet XLSX export).
  store/       zustand stores — useStore (data: DB, engine, toasts, file ops) and useUiStore
               (navigation only).
  ui/          components/ (primitives), layout/ (AppShell), views/ (Dashboard, Projects,
               ProjectDetail, Capacity, Forecast), timeline/ (the Timeline view and its Gantt bar
               / allocation-cell / date-math building blocks).
```

**Why this split:** the engine has zero dependency on the DB or React, so `tests/` can exercise
every calculation (capacity, gaps, sanity checks, forecast) directly against a `PlanningData`
fixture, with no DB or browser involved. The DB is the single source of truth; every mutation in
`useStore` writes through the repository, re-reads the full snapshot, and rebuilds a fresh
`PlanningEngine` — so the UI can never drift from what's actually persisted.

## Data model

Everything is capacity, not people:

- **`resource_pools`** — a discipline (Animation, Lighting, VFX, …) with a flat `capacity_fte`.
  **`pool_capacity_overrides`** lets capacity vary in a specific month (e.g. a contractor ramping
  down) without touching the flat baseline.
- **`projects`** — name, status, priority, and **nullable** start/end dates, each with its own
  `certainty` (`confirmed` / `estimated` / `tbd`). A project with no dates is simply unscheduled —
  never given a fake date to make the UI happy.
- **`requirements`** — "this project needs discipline X" — with **`requirement_allocations`**
  giving the FTE needed per month (demand can ramp up/down over the project's life).
- **`assignments`** / **`assignment_allocations`** — the mirror image: FTE actually committed per
  month. Required vs. assigned per pool per month is the whole staffing picture.

Time resolution is **monthly**, keyed by a `"YYYY-MM"` string (see `domain/periods.ts`). Every
engine method takes a `Period`. To move to weekly resolution later: add a week-key variant next to
`Period` and re-point the period-iteration helpers (`periodRange`, `addMonths`-equivalent) — the
schema (`period TEXT`) does not change, since it was never assumed to be month-shaped.

**Scenarios, ready but not built:** `requirements`, `assignments`, and `scenarios` all carry a
`scenario_id`; every plan today has exactly one row in `scenarios` (`base`, `is_base = 1`) and
`PlanningEngine` is constructed scoped to one scenario. Adding what-if scenarios later means
inserting more `scenarios` rows and letting the user pick which one `PlanningEngine` reads — no
schema migration, no breaking change to existing data.

## Sanity checks & forecast

`engine/validation.ts` computes, from the live plan, on every render:

- **Over capacity** (critical) — a pool's required FTE exceeds its capacity in some month.
- **Understaffed project** (warning, or critical for high/critical-priority projects with a large
  gap) — a project's assigned FTE is below what it requires.
- **Unstaffed requirement** (critical) — a requirement exists with zero assignment at all.
- **Capacity available but not assigned** (info) — deliberately distinct from the two above: it
  fires only when a project is short *and* some other project's spare capacity in that same pool
  could cover the gap, i.e. it's a staffing decision, not a hiring problem.
- **Invalid / outside-lifecycle dates** (critical) — end before start, or an allocation recorded
  outside the project's own start–end range.
- **TBD dates** (warning, not an error) — flags that timeline placement and forecasting are
  limited until dates are set, without blocking anything else.

`engine/forecast.ts` projects capacity vs. demand per pool per month with no AI involved — it is a
plain percentage-utilization threshold (`healthy < 90% < tight < 100% < over capacity`) — and
surfaces the first month each pool tips into trouble as a plain-language line ("Nov 2026: Animation
needs 1 additional FTE").

## Persistence

The working plan auto-saves to **IndexedDB** on every change, so a reload never loses work. That
autosave is *not* a real file — use the file menu (⋯ next to Save) for **New / Open / Save As /
Backup**, which read/write actual `.sqlite` bytes via the File System Access API where the browser
supports it, falling back to a plain download + `<input type=file>` picker otherwise (see
`persistence/files.ts`). **Save** re-writes the last-opened/saved file handle directly; if there
isn't one yet it behaves like Save As.

## Desktop packaging (Electron)

The same code also ships as a Windows desktop app via Electron — no code in `src/` changes for
this; the web build is loaded as-is inside a native window.

```
npm run electron:dev      # desktop shell against the live Vite dev server, with hot reload
npm run electron:build    # builds dist/ then packages a local NSIS installer into release/
```

`electron/main.cjs` is the entire native layer: it serves the built `dist/` through a custom
`app://` scheme (`sql.js`'s WASM load is a real `fetch`, which `file://` can't serve — hence the
custom protocol instead of loading the HTML file directly) and wires up auto-update.

**Auto-update:** the repo lives at `github.com/Mushra/CINE-ResourcePlanner` (public).
`.github/workflows/release.yml` builds and publishes a release to GitHub Releases — via
`electron-builder`'s native `github` publish provider — on any `v*` tag pushed, using the
automatic, no-setup-required `GITHUB_TOKEN` Actions secret. `electron-updater`'s matching `github`
provider checks for and downloads updates at runtime using `owner` + `repo`. Because the repo and
its releases are public, no token is needed for that read — nothing is embedded in the packaged
app, so there's nothing to leak either.

**One-time setup before the first real release:** none beyond having pushed the repo — bump
`package.json`'s `version` (electron-builder versions releases from it, not the tag; it must not
start with "v"), commit, then push a matching `v<version>` tag to trigger the workflow.

The packaged app is unsigned, so Windows SmartScreen will warn on first launch (code signing is a
separate, paid step not included here).

## Excel export

**Export** (topbar) produces a 4-sheet workbook via `export/xlsx.ts`: Portfolio Overview, Resource
Capacity (per discipline × month), Assignments (detail), and Sanity Checks (severity-sorted). Each
sheet has a frozen header row, autofilter, sensible column widths, and status-colored cells —
built with `exceljs`, not a generic CSV dump.

## Extending

- **New view:** add a component under `src/ui/views/`, a case in `App.tsx`'s view switch, and an
  entry in `AppShell.tsx`'s `NAV` array.
- **New resource pool:** just data — created from the Capacity/Projects UI, no code change.
- **New sanity check:** add a checker function in `engine/validation.ts` following the existing
  pattern (read from `PlanningEngine`, return `SanityCheck[]`), and append it to `getSanityChecks`.
  Add its expected behavior to `tests/validation.test.ts` first.
- **Weekly resolution:** see "Time resolution" above.
- **Scenarios UI:** the schema and engine are scenario-scoped already (see above); building the UI
  means letting the user create/select a `scenarios` row and passing its id into
  `new PlanningEngine(data, scenarioId)` instead of the hardcoded base scenario.

## Testing

`tests/` runs the engine in isolation via `vitest` — no DB, no browser. Fixtures in
`tests/fixtures.ts` build a small `PlanningData` snapshot by hand; `planning.test.ts`,
`validation.test.ts`, and `forecast.test.ts` cover capacity/requirement/assignment math, the
over-capacity/understaffed/available-vs-not-available distinctions, date-boundary and TBD
handling, and forecast thresholds.
