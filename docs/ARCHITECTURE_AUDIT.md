# Architecture Audit — CINE-ResourcePlanner

Evidence-based audit of the current codebase (`D:\Works\CINE-ResourcePlanner`, branch
`feature/cinematic-production-planner`, based on commit `38e04a5`), produced before any
implementation work. File:line references throughout are exact at the time of writing.

## 1. Stack and shape

- **Frontend**: React 19 + Zustand 5, Vite 8, TypeScript ~6.0. No routing library — a single
  `ViewName` union drives a manual switch in `App.tsx`.
- **Storage engine**: `sql.js` (SQLite compiled to WASM) — runs **entirely in the renderer
  process/browser tab**, in memory. No native SQLite binding, no server, no network database.
- **Desktop shell**: Electron, Windows-only packaging (`electron-builder.yml` configures only a
  `win`/`nsis` target; CI runs on `windows-latest` only). The Electron layer is deliberately thin —
  no preload script, no `ipcMain`/`ipcRenderer`, `contextIsolation: true`/`nodeIntegration: false`
  (`electron/main.cjs:154-163`). It exists solely to (a) host the web app in a native window and (b)
  wire up `electron-updater` against public GitHub Releases. All persistence APIs used
  (File System Access API, IndexedDB) are standard browser APIs identical in Electron and a real
  browser — the same code runs unmodified via `npm run dev` in a browser tab.
- **Import/export**: `exceljs` + `jszip` for `.xlsx` only. No CSV import. No `.mpp`/MS-Project
  handling anywhere.
- **Tests**: `vitest`, 45 tests across 5 files, ~100% focused on `src/engine/` and `src/domain/` —
  zero UI tests, zero E2E.
- **Scale**: ~11,300 lines of TypeScript/TSX across `src/`. Small, single-purpose codebase — an
  audit-friendly size.
- **CI**: one GitHub Actions workflow (`release.yml`), triggered only on `v*` tag pushes; runs
  `npm test` as a release gate. No CI runs on ordinary pushes/PRs.

## 2. Domain model (current)

Hierarchy, verbatim from the code's own header comment (`src/domain/types.ts:1-4`):

> "Discipline → ResourcePool (role) → Person. Requirements (demand) stay pool-level; assignments
> (supply) are person-level."

```text
Discipline
  └── ResourcePool (role, e.g. "Animator")
       └── Person (named individual)

Project
  ├── Requirement (Project × Pool, demand)  ──── RequirementAllocation (× Period, FTE)
  └── PersonAssignment (Project × Person, supply) ──── PersonAssignmentAllocation (× Period, FTE)
```

- **Everything is keyed by `Period = "YYYY-MM"`** (`src/domain/types.ts:6`) — monthly resolution
  only, everywhere, with no exceptions. `Project.startDate`/`endDate` are the only day-level fields
  in the entire schema.
- **Project is a flat leaf.** There is no sub-entity below Project in the schema. "Cinematic" exists
  only as a naming convention in seed/demo data and product branding — not a modeled entity,
  column, or table anywhere (`src/db/seed.ts`, confirmed by full-repo search).
- **Demand and supply are asymmetric by design**: demand (`Requirement`) is discipline-granular in
  practice — real per-role demand was migrated away in schema v6 (`migrateV5toV6`,
  `src/db/database.ts:213-298`) onto a synthetic zero-capacity "generic pool" per discipline — while
  supply (`PersonAssignment`) is always person-level. `getProjectDisciplineStaffing()`
  (`src/engine/planning.ts:336-357`) is the sole reconciliation point between the two granularities,
  and is explicitly documented as "the single source of truth" for staffing comparisons
  (`planning.ts:332-334`). The pool-level `getProjectStaffing()` still exists as public API but is
  largely vestigial now that demand doesn't live at pool granularity.
- **Zero of the following exist anywhere in the schema or domain types**: dependencies/predecessor-
  successor relationships, planned-vs-actual/variance fields, task/milestone identity, versioning or
  audit columns (`updated_at`, `created_by`, row version), Jira references, MS Project references.
  Each was confirmed by targeted grep across the whole `src/` tree, not just by absence of a
  matching table.
- **A genuinely reusable pattern already exists**: `structure_overrides`
  (`src/db/schema.sql:98-104`, `src/domain/overrides.ts`) is a name-keyed overlay table + a pure
  `applyStructureOverrides(data, overrides)` resolver, applied once centrally in the store's
  `reload()`. It lets a user restructure/rename org-chart entities **without ever mutating the
  imported baseline row**, so overrides survive a re-import that matches by name. This is precisely
  the shape ("baseline never silently mutated; changes go through explicit, named override
  records") the target product needs for protecting the committed plan — see `PLANNING_ENGINE.md`
  and `DATA_MODEL.md`.

## 3. Planning/calculation engine (current)

`src/engine/` — `planning.ts` (502 lines), `validation.ts` (369 lines), `forecast.ts` (24 lines).
Explicitly designed with zero DB/React dependency, exercised directly by `vitest` against
hand-built `PlanningData` fixtures (`tests/fixtures.ts`). This split is the single best piece of
existing architecture to preserve and extend.

- **`PlanningEngine`** (`planning.ts:71-498`) builds `Map`-based indexes once at construction, then
  exposes pure getters: capacity, required/assigned/available capacity, capacity gap, discipline
  rollups, per-project and per-person staffing breakdowns, active/allocated period discovery. Every
  public number is rounded once via `round2()`; comparisons use a `0.001` epsilon to avoid
  floating-point false positives. Scenario-scoped, but only one scenario (`base`) is ever used in
  practice.
- **`getSanityChecks()`** (`validation.ts:41-69`) runs 11 deterministic checker categories
  (over-capacity, understaffed/unstaffed/over-allocated project or person, assignment-without-
  requirement, available-not-assigned, duration-mismatch, invalid/TBD dates) and feeds the
  Dashboard's "Needs attention" panel, project health badges, and the XLSX "Sanity Checks" sheet.
  This is already exactly the "what requires attention, and why" mechanism the target product's UX
  vision (brief §18) wants — it just needs new categories, not a new mechanism.
- **`forecast.ts` is much thinner than the README describes.** The README (`README.md:91-94`)
  describes percentage-utilization threshold banding ("healthy < 90% < tight..."); the actual file
  only computes a clamped period window (`getForecastWindowPeriods`). The threshold/banding logic,
  if it exists, lives in a UI component rather than `engine/` — a violation of the project's own
  stated architecture principle that calculation logic belongs in the DB/UI-free engine layer where
  `tests/` can reach it. **Recommendation**: when building the new day-level forecast engine for
  LOQs (see `PLANNING_ENGINE.md`), also relocate any UI-embedded capacity-threshold logic into
  `engine/` as part of the same effort, restoring the architecture's own invariant rather than
  leaving two inconsistent examples side by side.
- **No dependency/scheduling engine exists** — "schedule" today is nothing more than per-month FTE
  numbers against a project's own fixed lifecycle. There is no task graph and nothing to propagate
  along one.

## 4. Persistence (current)

- **`sql.js` in-memory only.** The canonical bytes exist in three possible places, none of them a
  server: (1) the in-memory WASM heap while the app is open; (2) **IndexedDB**, autosaved on *every*
  mutation via a fire-and-forget `void saveAutosave(bytes)` (`src/store/useStore.ts:164-171`, 33
  call sites); (3) an actual `.sqlite` file **only** after the user explicitly uses Save/Save As via
  the File System Access API (`src/persistence/files.ts`) — Firefox and any browser without that API
  fall back to a forced download instead of writing back to the original file.
- **No transactions anywhere.** Multi-statement operations (migrations, batch shifts, imports) issue
  many individual statements in a loop with no `BEGIN`/`COMMIT`. Because `persist()` runs
  synchronously right after every mutation, a mid-loop exception can get autosaved before anyone
  notices.
- **Foreign keys are declared but never enforced.** `PRAGMA foreign_keys` is never turned on
  (confirmed: no occurrence anywhere in `src/`). Every `ON DELETE CASCADE`/`SET NULL` in
  `schema.sql` is therefore purely documentation; real referential integrity is hand-implemented in
  `src/db/repository.ts`'s delete functions, with a defensive `healDanglingReferences()` /
  `healDuplicateGenericPools()` sweep run on every DB open to repair whatever the hand-written code
  missed (`src/db/database.ts:62-139`). This has already caused two real, shipped data-corruption
  bugs (duplicate generic pools from a name-matching mismatch; dangling assignment/requirement rows
  after delete) — both fixed reactively, not by turning on FK enforcement.
- **`deleteProject` had the same bug class** — it used to issue a bare `DELETE FROM projects WHERE
  id = ?` with no cleanup of dependent `requirements`/`requirement_allocations`/`person_assignments`/
  `person_assignment_allocations`, and `healDanglingReferences()` didn't check `project_id` against
  `projects` either, so deleting a project could leave "phantom FTE" rows exactly like the bug
  `5d85a77` fixed for people/pools/disciplines. **Resolved** (`ec5f0b1`): `deleteProject` now cascades
  both dependent tables, and `healDanglingReferences()` sweeps any pre-existing phantom rows left by
  a save from before the fix. Phase 1's schema work extended the same cascade to cover
  `cinematics`/`loqs` and their own children once those tables landed.
- **No row-level IDs beyond `newId()`** (`repository.ts:23-26`, `Date.now()` base36 + random suffix)
  — collision-safe enough for a single synchronous single-user process, not designed for concurrent
  writers.
- **No versioning, no audit trail, no snapshots, no undo/redo anywhere.** Confirmed by grep across
  `schema.sql` for `updated_at`/`created_at`/`created_by`/`version` — zero matches. The only
  "backup" mechanism is the user manually choosing Save As.
- **`scenarios` table + `scenario_id` FK on `Requirement`/`PersonAssignment`** is real, wired through
  the engine, but only ever has one row in practice. This is dormant scaffolding, not a shipped
  feature — a candidate mechanism worth evaluating for reuse (see `COLLABORATION_MODEL.md`), but not
  something to assume is "basically done."
- **Confirmed with the product owner**: there is no separate/external SQL database for this
  planning domain anywhere in the studio's tooling. "SQL as the canonical shared store" is new
  infrastructure to build, not an existing system to adopt.

## 5. Import/export (current)

- **Two Excel-only importers**, both fragile and locale-specific: an "RPM export" parser
  (`src/import/rpmImport.ts`) hard-matches exact French column headers from a third-party
  production-resource-management tool's "Filtered Requests" report (RPM is that external tool's
  name, not an acronym coined by this app), and a "Staffing_Cinematics_Consolidated" workbook parser
  (`src/import/staffingImport.ts`) that also patches the uploaded file's internal XML to work around
  a specific `exceljs` bug. Both derive project start/end dates purely from which month-columns have
  non-zero FTE, both populate only *supply* (assignments) and never *demand* (requirements), and
  neither has a preview/dry-run step — the import commits immediately and only shows a report
  afterward.
- **No CSV import at all.** **No MS Project (`.mpp`/XML) import or export at all** — confirmed by
  grep for `mpp`, `msproject`, `duration`, `predecessor` across the whole repo; there is nothing to
  build on here, this is a from-scratch integration.
- **Export**: a generic `csv.ts` utility (used only by the People view's "Export CSV" button) and a
  4-sheet XLSX report (`src/export/xlsx.ts`) computed live from the engine, not a round-trippable
  copy of any imported data.
- **No Duration-vs-Work distinction anywhere.** Effort is FTE-per-month only; there is no separate
  concept of total work (person-days) independent of calendar spread, no working-calendar/holiday
  model. This directly affects how MS Project's `Duration`/`Work`/`%Complete` fields should be
  interpreted on import — the mapping cannot be inferred from existing code and needs a real sample
  MPP export to design against.

## 6. UI/UX (current)

- **5 nav views** (`Dashboard`, `Timeline`, `Projects`, `Team`, `People`) plus 2 drill-down detail
  views (`ProjectDetail`, `PersonDetail`) — no routing library, a manual view-name switch.
- **Dashboard** (`src/ui/views/Dashboard.tsx`, 775 lines) already implements the brief's "what
  requires attention, and why" philosophy: KPI tiles, a severity-grouped "Needs attention" panel
  sourced from `getSanityChecks()`, and several capacity/occupancy visualizations. This is the
  closest existing analog to the target's "Control Tower" / "Attention Points" view — extend it,
  don't replace it.
- **Timeline** (`src/ui/timeline/`, ~1,200 lines across `Timeline.tsx` + supporting files) is a real
  Gantt-like view: draggable/resizable Project bars, expandable into Discipline → Pool → Person rows
  with per-month FTE. The day-level pixel math (`timelineMath.ts`'s `xForIsoDate`/`isoDateForX`)
  already exists and operates on real ISO dates even though the data feeding it today is
  month-grain — this is directly reusable for rendering day-level committed/forecast LOQ bars later.
- **Zustand is a read cache of the DB, never the source of truth.** Every mutation writes through
  `repository.ts`, then `reload()` re-reads the *entire* snapshot from SQL and rebuilds a fresh
  `PlanningEngine` — "so the UI can never drift from what's actually persisted" (verified in code,
  matches the README's claim). This write-then-reread discipline is worth preserving as the new
  entities are added.
- **No permission/role model exists at all** — fully single-user, no accounts, no `role`/`permission`
  field anywhere. Any Producer/AP distinction the target wants is net-new.
- **"Local JQL-like querying" does not exist**, confirmed independently by two separate research
  passes. What exists instead: a fixed-dimension `GlobalFilter` (Site/Team/Discipline
  multi-select), a fuzzy-match `CommandPalette` (Ctrl/Cmd+K "jump to…"), and plain substring search
  boxes on Timeline/People. None of these is a query language. Treat this brief item as aspirational
  and out of scope for the vertical slice (matches the brief's own emphasis on actionability over
  generic querying, §18).

## 7. Target-concept mapping table

| Target concept | Existing implementation | Reusable? | Required change | Risk |
|---|---|---|---|---|
| Portfolio | Implicit (one `.sqlite` file = one portfolio) | Yes, as-is | None for V1 | Low |
| Project | `projects` table, day-level start/end + certainty, status, priority | Yes, fully | None structural | Low |
| Cinematic | Does not exist (branding-only) | No | New `cinematics` table under `Project` | Medium |
| Discipline Production Plan | Doesn't exist; analog: `getProjectDisciplineStaffing()` computes a discipline rollup on demand | Pattern reusable | Model as a **computed view** over LOQs, not a stored table (see `PRODUCT_MODEL.md` §4) | Low if kept computed; Medium if (wrongly) stored |
| LOQ | Nothing structurally similar — `Requirement` is a monthly FTE rate, not a task | No | New `loqs` table: Jira key, cinematic/discipline FK, type, committed/forecast/actual dates, status, estimate, DoD ref | High — the single biggest domain addition |
| Resources on a LOQ | `people` + `person_assignments` exist, keyed to Project, monthly | Partially | Re-key assignment to LOQ/Cinematic; may need day-level allocation in addition to monthly FTE | Medium |
| Day-level schedule | Only `Project.startDate/endDate` are day-level; everything else is monthly | Partially (date math + pixel math in Timeline already exist) | Add day-level committed/forecast/actual date fields on LOQ; keep monthly FTE engine untouched | Medium-High |
| Dependencies | Zero | No | New `loq_dependencies` table + one forward-propagation pass (not a general graph engine) | Medium |
| Committed/Forecast/Actual | Zero (only plan-vs-plan today: Requirement vs Assignment) | `structure_overrides` overlay *pattern* reusable | New tables; forecast should be **computed**, never stored+edited directly (see `PLANNING_ENGINE.md`) | High — the core new capability |
| Variance taxonomy | Zero | No | New `variance_reasons` enum + `variance_events` table | Low-Medium |
| History / audit | Zero anywhere (no `updated_at`/`created_by`/version column exists) | No | New append-only `plan_change_log` table | Medium |
| Jira integration | Zero references anywhere | No | New adapter, following the existing "parse → normalize → apply" import shape | High — real Jira structure unknown, needs discovery spike |
| MS Project integration | Zero references, no Duration/Work vocabulary anywhere | No | New adapter, same parse→normalize→apply shape as the two existing Excel importers | High — real MPP shape unknown, needs sample files |
| Shared SQL backend | `sql.js` is local/in-browser only; no external DB exists anywhere in scope | Schema/repository *pattern* reusable; the physical engine is not | New server-hosted DB + sync protocol; local file becomes offline cache | High — new tier, not an evolution |
| Local edits / push / conflict detection | Zero concurrency model; only manual same-file open/save, last-write-wins | No | Add optimistic concurrency (version + timestamp) before anything fancier | High |
| Permissions (Producer/AP) | Zero — no roles anywhere | No | Minimal role field + capability gating; meaningless without a backend to enforce it server-side | Medium once a backend exists |
| "Attention points" / Control Tower UX | Dashboard's "Needs attention" panel + severity-grouped sanity checks already does this | Yes, substantially | Add new `SanityCheck` categories for LOQ/variance/dependency risk | Low — matches an existing, documented extension point |
| Gantt/timeline | `Timeline.tsx` + `timelineMath.ts` already render nested Project→Discipline→Pool→Person bars with day-pixel math | Yes, substantially | Extend to render Cinematic/LOQ rows with committed vs. forecast bars | Medium |
| Capacity engine (FTE/month, flat 5-day week, no holidays) | Exact match to the target's "deliberately simple" capacity model | Yes, fully — the closest match in the whole audit | None | Low |
| Local JQL-like querying | Does not exist | No | Out of scope for V1 (brief itself deprioritizes this) | Low (defer) |

## 8. Highest-priority technical debt found (not fixed during this audit)

Ordered by how directly they'd undermine the new work if left unaddressed:

1. **`deleteProject` doesn't cascade-clean dependents** (§4) — will produce phantom FTE/LOQ rows
   once Cinematics/LOQs hang off Project; should be fixed before LOQ data starts accumulating.
   **Resolved** (`ec5f0b1`).
2. **`PoolCapacityOverride` is stored, editable in the UI, and even collected into
   `allKnownPeriods()`, but is never read by `getCapacity()`** (`planning.ts:191-196` ignores its
   `period` argument and never queries the override table) — a live, silent no-op feature. Anyone
   extending capacity logic should not assume this table has any effect today.
   **Resolved** — removed entirely (`55fcbbf`).
3. **Dual project-status representation** — `Project.status` (stored) vs. `deriveProjectStatus()`
   (computed live from dates, source of truth for validation) can silently disagree, because new
   imports always write `status: 'active'` regardless of actual dates. This exact "stored value that
   can drift from a computed one" failure mode is the strongest argument in this whole audit for
   making **LOQ forecast dates computed-only**, never a stored field a human can also edit directly
   — see `PLANNING_ENGINE.md`. **Resolved** — every remaining raw read now routes through
   `deriveProjectStatus()` (`6bbfedb`).
4. **No CI on ordinary pushes**, only on release tags — a broken `main` could sit unnoticed for a
   while. Worth tightening once new domain logic starts landing, but out of scope for the audit
   itself. **Resolved** — lint/typecheck/tests now run on every push and PR (`60aa02b`).
5. **Zero UI test coverage** — acceptable historically because the engine is the part with real
   logic, but the new Cinematic/LOQ/variance UI will need at least some interaction coverage before
   it's safe to iterate on quickly. **Resolved** — `tests/ui/` harness plus coverage suites across
   Projects, ProjectDetail, People, Team and Dashboard (`1190ab1`).
