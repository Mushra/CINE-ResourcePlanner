# Implementation Plan — Phased, Vertical-Slice-First

This plan sequences the work so the full planning loop (brief §23) is validated on **one Cinematic**
before any expansion — matching the brief's explicit instruction not to redesign every screen first.
Every phase after Phase 0 is additive to the existing schema/engine/UI; nothing here proposes
rewriting working functionality.

## Phase 0 — This audit (current)

- **Objective**: understand the system, challenge the brief, produce the documents in this
  directory.
- **Files/components affected**: `docs/*.md` only.
- **Dependencies**: none.
- **Acceptance criteria**: the six documents exist, are evidence-based (cite real file:line), and
  identify at least the contradictions/gaps found in `ARCHITECTURE_AUDIT.md` §7-§8.
- **Tests**: none (documentation only).
- **Migration considerations**: none — no schema/code changes in this phase.

## Phase 1 — Schema foundation + fix the one live bug this work would otherwise inherit

- **Objective**: add the new tables from `DATA_MODEL.md` (migration v6→v7), and fix
  `deleteProject`'s missing cascade cleanup (`ARCHITECTURE_AUDIT.md` §8.1) before Cinematics/LOQs
  start hanging off projects and inheriting that bug's blast radius.
- **Files/components affected**:
  - `src/db/schema.sql` — add `cinematics`, `loqs`, `loq_commitment_events`, `loq_resources`,
    `loq_dependencies`, `dependency_templates`, `variance_events`, `jira_sync_state`.
  - `src/db/database.ts` — `migrateV6toV7()` following the existing ladder pattern; bump
    `SCHEMA_VERSION`.
  - `src/db/repository.ts` — typed CRUD for the new tables, following existing conventions
    (`newId()`, explicit cascade deletes since FK enforcement is still off — see
    `ARCHITECTURE_AUDIT.md` §4); also fix `deleteProject` to cascade-clean `requirements`/
    `requirement_allocations`/`person_assignments`/`person_assignment_allocations` (and, once
    added, `cinematics`/`loqs`) the same way `deletePool`/`deleteDiscipline`/`deletePerson` already
    do.
  - `src/db/database.ts` — extend `healDanglingReferences()` to also cover `project_id` orphans
    (closing the gap identified in the audit) and the new tables' FKs.
  - `src/domain/types.ts` — new TypeScript interfaces mirroring the new tables.
- **Dependencies**: Phase 0.
- **Acceptance criteria**: a fresh DB and a migrated v6 DB both end up with identical schemas;
  deleting a project no longer leaves orphaned rows (new regression test, mirroring
  `tests/migration.test.ts`'s style); all 45 existing tests still pass unmodified.
- **Tests**: new `tests/migration.test.ts` cases for v6→v7; new `tests/repository.test.ts` (doesn't
  exist yet — first dedicated repository test file) covering the new cascade-delete fix and the new
  tables' CRUD.
- **Migration considerations**: purely additive; existing data untouched. The `deleteProject` fix
  changes behavior (previously-orphaned rows from past deletes get swept up by the extended
  `healDanglingReferences()` on next load) — worth a one-line release note since it will visibly
  clean up any pre-existing corruption a studio user's file might already have.

## Phase 2 — Deterministic LOQ/forecast engine (no UI yet)

- **Objective**: implement `PLANNING_ENGINE.md` in full: `computeForecast()`, dependency
  propagation with root-cause attribution, the bottom-up Cinematic-demand aggregation that feeds the
  existing top-down capacity comparison, and the five new `SanityCheck` categories — all as pure
  functions, zero DB/UI dependency, exactly like `src/engine/planning.ts` today.
- **Files/components affected**:
  - `src/engine/loqPlanning.ts` (new) — `computeForecast`, dependency-graph propagation, root-cause
    walk.
  - `src/engine/validation.ts` — extend `getSanityChecks()` with the five new categories
    (`loq_at_risk`, `loq_root_cause`, `loq_early_opportunity`, `jira_inconsistency`,
    `capacity_conflict_cinematic`), following the existing checker-function pattern.
  - `src/domain/types.ts` — `PlanningData` gains the new entity arrays.
  - As a side-cleanup identified in the audit (`ARCHITECTURE_AUDIT.md` §3): relocate any
    UI-embedded capacity-threshold logic found in the Forecast-adjacent UI back into `engine/`,
    restoring the "engine holds all calculation logic" invariant before adding to it.
- **Dependencies**: Phase 1 (needs the new tables to build fixtures against).
- **Acceptance criteria**: hand-built `PlanningData`-style fixtures (new `tests/loqFixtures.ts`,
  same shape as `tests/fixtures.ts`) can exercise: a simple two-LOQ finish-to-start dependency chain
  where delaying the predecessor produces the correct forecast delta on the successor without
  double-counting; a LOQ with its own variance correctly identified as root cause vs. a downstream
  LOQ correctly identified as impact-only; an early-completion opportunity correctly flagged and
  correctly *not* auto-applied; the bottom-up/top-down capacity conflict correctly detected on a
  fixture with mismatched numbers.
- **Tests**: `tests/loqPlanning.test.ts`, `tests/loqValidation.test.ts` — written *before* the UI
  that will consume them, per the brief's working rule ("write tests for planning rules before
  expanding implementation").
- **Migration considerations**: none (pure logic, no schema change).
- **Status (shipped on `feature/cinematic-production-planner`, `loq_forecast` commits 1-4, after
  Phase 3)**: shipped out of the plan's original order — the whole Phase 3 UI slice landed first,
  deliberately deferring this phase (see Phase 3's status note). `computeForecasts()` and dependency
  propagation + root-cause attribution live in `src/engine/loqForecast.ts` (not `loqPlanning.ts` as
  originally named), tested in `tests/loqForecast.test.ts`. Wired into `PlanningEngine.getLoqForecasts()`
  /`cinematicLoqForecasts()` (`planning.ts`), cached per-instance. Three of the five sanity-check
  categories are implemented — `loq_at_risk`, `loq_root_cause`, `loq_early_opportunity`
  (`validation.ts`, tested in `tests/validation.test.ts`); `capacity_conflict_cinematic` shipped
  earlier as part of Phase 3's slice; `jira_inconsistency` stays deferred (gated on a Jira sync
  existing at all, Phase 5). See `PLANNING_ENGINE.md` §5/§6/§8 for the exact rules and two documented
  deviations from this phase's original wording (latest-variance-wins instead of summed deltas;
  `lagDays` excluded from the propagation shift magnitude). A minimal UI surfacing (forecast overlay
  bar on the LOQ timeline) also shipped in this same commit sequence, ahead of Phase 4 — see Phase 3's
  updated acceptance-criteria note.

## Phase 3 — Minimal UI for one Cinematic

- **Objective**: make the Phase 1-2 work visible and editable for exactly one Cinematic on one
  Project, reusing existing UI primitives (`Drawer`, `ConfirmDialog`, `Toaster`, form-drawer
  dirty-tracking pattern) rather than inventing new ones.
- **Files/components affected**:
  - `src/ui/views/ProjectDetail.tsx` — add a Cinematics list/tab.
  - `src/ui/views/CinematicDetail.tsx` (new) — LOQ list with committed/forecast/actual columns,
    status, a "declare variance" action, a "re-commit" action (both requiring the reason/comment
    fields from `PLANNING_ENGINE.md` §3-4).
  - `src/store/useStore.ts` — new actions (`createCinematic`, `createLoq`, `declareVariance`,
    `recommitLoq`, `setLoqResources`, `setLoqDependency`), following the existing
    write-then-`persist()`-then-`reload()` pattern exactly.
  - `src/ui/components/ValidationRulesDialog.tsx` — document the five new check categories
    alongside the existing 11, keeping the "hand-maintained mirror of validation.ts" pattern the
    audit flagged as a drift risk — worth adding a one-line comment/test asserting the dialog's
    category list matches `CheckCategory` at the type level, closing that specific drift risk while
    we're touching this file.
- **Dependencies**: Phase 2.
- **Acceptance criteria**: a Producer can, for one Cinematic: create LOQs, assign resources,
  declare a dependency, declare a variance, see the forecast update accordingly, see the Dashboard's
  "Needs attention" panel surface the new check categories, and see a LOQ's commitment history.
  Manual UI verification via `npm run dev` (per working rules: UI changes must be exercised in a
  browser before being called done, not just type-checked).
- **Tests**: none new beyond Phase 2's engine tests (UI test coverage is out of scope for the
  vertical slice per the audit's own finding that the existing app has zero UI tests — matching
  existing conventions rather than introducing a new testing discipline mid-slice).
- **Migration considerations**: none.
- **Status (shipped on `feature/cinematic-production-planner`, `loq_ui` commits 1-7 + `loq_events`
  commits 1-6)**: Cinematic + LOQ + LoqResource CRUD shipped for every Cinematic (not scoped to a
  single one), plus a day-level drag timeline (`src/ui/components/LoqTimeline.tsx`) beyond this
  phase's original minimal-list scope — one draggable bar per LOQ spanning its committed window (or
  the implicit `loqEffectiveFinish`-derived window), expandable to per-person `LoqResource` bars.
  The `loq_ui` slice's **V1 shortcut** (committed dates written straight through `updateLoq`, no
  history) is now **closed**: `recommitLoq` (`useStore.ts`) writes an append-only
  `loq_commitment_events` row and updates the cache in one call, `LoqFormDrawer` no longer exposes
  committed-date inputs, and `RecommitDialog` is the only path to a committed-date change — it also
  shows the LOQ's commitment history. `declareVariance` + `VarianceDialog` ship the §4 variance flow
  (signed `deltaDays` computed once at declaration, category from the §4.1 taxonomy). LOQ dependency
  CRUD ships too (`createLoqDependency`/`updateLoqDependency`/`deleteLoqDependency` +
  `LoqDependencyEditor`), with cycle rejection via `wouldCreateCycle` (`src/domain/loqGraph.ts`) —
  scoped to edges **within a single Cinematic**, `type` fixed to `finish_to_start`, `source` always
  `'override'` (no templates). Attribution across all three flows is a single global producer-name
  preference (`useUiStore`, localStorage), not per-user login.
  This phase's acceptance criteria were initially met **except** "see the forecast update
  accordingly" and "see the Dashboard's 'Needs attention' panel surface the new check categories" —
  those two depended on Phase 2's `computeForecast()`/propagation/root-cause work, deferred at the
  time. **Both are now met** too: Phase 2 shipped afterward (see its status note) and included a
  minimal forecast overlay on `LoqTimeline.tsx` plus the three new check categories flowing through
  the existing Dashboard panel unchanged. Only `jira_inconsistency` (Jira-gated) and the Phase 4
  nested "one root cause / N impacts" view remain outstanding.
  Contrary to this phase's original testing note, UI test coverage *was* added
  (`tests/ui/*.test.tsx`, integration-style against a real sql.js-backed store) — the "zero UI tests"
  baseline it cited no longer holds project-wide, so later phases should follow that convention too.

## Phase 4 — Dependency-impact UX (root cause vs. downstream impact)

> **Narrowed scope**: the engine side of this phase (root-cause attribution, `impactedLoqIds`,
> `loq_root_cause` carrying the downstream chain as text) shipped early as part of Phase 2
> (`loq_forecast` commits 1 and 3). What remains is purely the **nested Dashboard UX** — today
> `loq_root_cause`/`loq_at_risk` render as flat rows like every other check; this phase turns the
> `impact` text into an actual nested "one root cause, N impacted LOQs" grouping.

- **Objective**: surface brief §7's "one root cause, N downstream impacts" view, reusing the
  Dashboard's existing severity-grouped "Needs attention" panel rather than building a new visual
  language.
- **Files/components affected**: `src/ui/views/Dashboard.tsx` (new grouping for
  `loq_root_cause`/impact chain), possibly a small new `src/ui/components/ImpactChain.tsx` if the
  existing issue-row rendering can't express a nested chain cleanly.
- **Dependencies**: Phase 3 (shipped); the engine data this phase needs (`rootCauseLoqId`,
  `impactedLoqIds`) is already available from Phase 2's `loq_forecast` work.
- **Acceptance criteria**: a manually-constructed three-LOQ dependency chain with one declared
  variance shows exactly one root-cause entry with two impacted LOQs listed under it, not three
  separate issue rows. (The underlying data already supports this today — `tests/validation.test.ts`'s
  `loq_root_cause` tests cover it at the `getSanityChecks()` level; this phase is UI grouping only.)
- **Tests**: `tests/validation.test.ts` already covers the engine-level chain case; this phase adds
  UI tests for the nested grouping component itself.
- **Migration considerations**: none.
- **Status (shipped on `feature/cinematic-production-planner`, `loq_impact_ux` commits 1-3)**: as
  scoped in the "Narrowed scope" note above — the engine side stayed untouched; `SanityCheck` gained
  `loqId` (on all three LOQ checks) and `impacted: { loqId, label, deltaDays }[]` (on `loq_root_cause`
  only), reusing the existing `loqLabel()` helper. `Dashboard.tsx` computes a suppression set from
  every `loq_root_cause`'s root + impacted LOQ ids, drops any `loq_at_risk` row whose LOQ is in that
  set before grouping, and renders the root cause's impacted LOQs as a nested `.issue-impact-chain`
  list (label + `+Nd` chip, clickable to the project) in place of the flat impact line — reusing the
  existing `.issue-row`/`.issue-body` markup, no new component. A three-LOQ chain (`A → B → C`, one
  variance on `A`) now shows exactly one root-cause row with two nested impacts instead of four flat
  rows; covered by `tests/validation.test.ts` (structured fields) and `tests/ui/dashboard.test.tsx`
  (rendered nesting + absence of standalone rows). See `PLANNING_ENGINE.md` §6/§8 for the exact shape.
  `jira_inconsistency` remains the only deferred check category (Phase 5).

## Phase 5 — Jira binding + date/status verification

### Phase 5a — Pure layers, manual-export bridge, UI drawer — **shipped**

- **Objective**: per `INTEGRATIONS.md` §3. Propose bindings between Cinematics/LOQs and Jira issues
  via a **cascade of signals tried by decreasing confidence** — pre-existing `jiraKey`, then the
  "Cinematics List"/"LOQ Target" custom fields, then an Epic Link/Parent relationship, then
  name-similarity — let the user confirm/override each one per Project, and surface
  committed-date/status/pause disagreement as a signal-only `jira_inconsistency` check — Jira never
  writes `loqs.status`, any committed/forecast date, or the plan's own `paused` flags. No real
  network client yet: a Jira REST search-response exported to `.json` is the manual bridge
  (`INTEGRATIONS.md` §3.1), swapped for a real HTTP client in 5b without touching anything below
  the parse layer. A discovery spike against the real instance (`OVR`/`NEO` projects) **invalidated
  the original Epic→children assumption** mid-phase (no real hierarchy on `OVR`) and confirmed the
  cascade design in `INTEGRATIONS.md` §3.1/§3.2 instead — see that doc for the full rationale.
- **Files/components affected**: `src/import/jiraSync.ts` (pure parse/normalize of a Jira REST
  `/search` response, incl. the "Cinematics List"/"LOQ Target"/"CIN level" scope/Epic Link picklist
  fields, defensively unwrapping `{value}` objects), `src/domain/jiraBinding.ts` (pure cascade
  binding heuristic — `exact-key` → `cinematics-field` → `epic-link` → `name` → `unmatched`, each
  proposal tagged with its `via: BindingKind` — in the spirit of `identity.ts`'s `personMatchKey`),
  `src/db/applyJiraSync.ts` (project-scoped apply + `jira_sync_state` upsert),
  `src/engine/planning.ts`/`src/engine/validation.ts` (`jira_inconsistency` check against the
  date-tolerance + status matrix in `INTEGRATIONS.md` §3.3, incl. the `PAUSED` status bucket and its
  two-way pause-mismatch signal), `src/domain/types.ts`/`src/db/repository.ts`/`src/db/schema.sql`
  (`Cinematic.paused`/`Loq.paused`, independent manual booleans — Jira's `PAUSED` bucket only ever
  compares against them, never sets them), `src/ui/components/CinematicFormDrawer.tsx`/
  `LoqFormDrawer.tsx` (pause toggle), `src/persistence/files.ts` (`.json` file picker),
  `src/store/useStore.ts` (`loadJiraExportFile`/`applyJiraBindingsToProject`),
  `src/ui/components/JiraBindingDrawer.tsx` (interactive binding UI with a per-row signal badge,
  mirroring `MppImportDrawer.tsx`), wired into `src/ui/views/ProjectDetail.tsx`'s Cinematics card.
  `cinematics.jira_key` added (schema v9); `cinematics.paused`/`loqs.paused` added (schema v10).
- **Dependencies**: Phase 1 (schema), Phase 3 (LOQs to sync against), Phase 6 (an imported `.mpp`
  may already carry `loqs.jira_key`, which the heuristic trusts as an exact match).
- **Acceptance criteria**: met — a Cinematic/LOQ with a pre-existing `jiraKey` present in the batch
  binds directly (`via: 'exact-key'`), never filtered by scope; unmatched rows fall through the
  cascade (field match → Epic Link → name-similarity above a fixed threshold), each proposal
  labeled with the signal that produced it and editable via an override `<select>` (including
  "don't link"); an optional scope filter (`CIN level`) excludes other-department candidates before
  the cascade runs on projects that need it; the drawer auto-applies when every proposal is already
  an exact key; a `jiraKey` already claimed by a different row, or one outside the target Project,
  is skipped with a warning, never reassigned; an unmapped Jira status surfaces its own warning
  rather than being guessed into TODO/IN PROGRESS/DONE/PAUSED; committed-date/status mismatches
  beyond tolerance, and a plan↔Jira pause mismatch in either direction, appear in "Needs attention"
  as `jira_inconsistency`; `loqs.status`/committed dates/`paused` are provably untouched even when
  the linked issue is Done or pause-shaped; a paused LOQ is excluded from `loq_at_risk`/
  `loq_root_cause`/`loq_early_opportunity`.
- **Tests**: `tests/jiraSync.test.ts` (parse layer, incl. the picklist fields), `tests/jiraBinding.test.ts`
  (full cascade incl. scope filtering), `tests/applyJiraSync.test.ts` (project-scoped apply, incl.
  cross-project collision and idempotent re-application), `tests/validation.test.ts`
  (`jira_inconsistency` date/status/pause cases, `PAUSED` bucket mapping, paused-LOQ exclusion from
  the forecast checks), `tests/ui/jiraBinding.test.tsx` (drawer + mapping step + signal badge +
  override, via `ProjectDetail`), `tests/migration.test.ts` (v9→v10 `paused` migration).
- **Migration considerations**: schema v8→v9, additive only (`cinematics.jira_key` column + partial
  unique index) — see `migrateV8toV9` in `database.ts`; schema v9→v10, additive only
  (`cinematics.paused`/`loqs.paused`, default 0) — see `migrateV9toV10`.

### Phase 5b — Real HTTP client (structure confirmed, engineering not yet started)

- **Objective**: replace the manual `.json` bridge with a real Jira client. The discovery-spike
  *research* this phase used to be gated on (`INTEGRATIONS.md` §4 step 1) is now done — see
  `INTEGRATIONS.md` §3.1 for the confirmed structure — so what remains here is purely the
  engineering: secret storage, the HTTP client, and a Settings screen.
- **Files/components affected**: `electron/main.cjs` (`safeStorage`-encrypted token storage,
  `fetch`-based paginated JQL search, Bearer PAT auth per `INTEGRATIONS.md` §3.1 — the confirmed
  instance is Server/DC, not Cloud), `electron/preload.cjs`
  (`contextBridge.exposeInMainWorld('jira', ...)`), `src/store/useStore.ts` (`syncJira(projectId)`),
  a `JiraProjectConfig` repository layer (`settings` table, per-Project, no secret — field mapping
  defaults per `defaultJiraFieldMapping()`), and the app's first Settings screen (base URL, Jira
  project key, PAT entry, `scopeValue`, custom date-field ids — including resolving which of the two
  competing `OVR` start-date fields is canonical, still open — and tolerance days).
- **Acceptance criteria**: real token round-trips through `safeStorage` without ever touching the
  shared plan file; "Synchroniser avec Jira" on a real Project produces the same binding
  cascade/drawer/report as the 5a fixture path, populates `jira_sync_state`, and the
  `jira_inconsistency`/pause checks read consistently off real data.
- **Tests**: fixture-based tests against a captured real sample of Jira API responses (the `.scratch/`
  discovery-spike captures qualify).
- **Migration considerations**: none beyond Phase 5a's `jira_sync_state`/`jira_key`/`paused` columns.

## Phase 6 — MS Project import adapter — **shipped**

- **Objective**: per `INTEGRATIONS.md` §2 (confirmed mapping + shipped architecture). A single
  `.mpp` import always targets exactly one existing Project and writes only within that Project's own
  Cinematics/LOQs/dependencies/resources — it never modifies any other Project's data
  (`INTEGRATIONS.md` §2.3 spells out how this is enforced structurally, including the cross-project
  `jiraKey` collision case).
- **Files/components affected**: `java/MppToJson.java` (MPXJ shim), `resources/mpp/lib/*.jar`
  (vendored), `scripts/prepare-mpp-runtime.mjs` (shim compile + jlink at build time),
  `electron/main.cjs`/`electron/preload.cjs` (IPC bridge, bundled-JRE spawn), `src/import/mppImport.ts`
  (pure parse layer), `src/db/applyMppImport.ts` (project-scoped reconciler),
  `src/domain/identity.ts` (`personMatchKey` fuzzy people-matching), `src/store/useStore.ts`
  (`parseMppFile`/`applyMppImportToProject`), `src/ui/components/MppImportDrawer.tsx` (interactive
  discipline-mapping UI), wired into `src/ui/views/ProjectDetail.tsx`'s Cinematics card.
- **Dependencies**: Phase 1 (schema), Phase 3 (something to import into); the sample-file discovery
  spike in `INTEGRATIONS.md` §2.1 — complete.
- **Acceptance criteria**: met — discipline codes (Text1), LOQ type (Text2) and Jira key (Text3) map
  correctly; cinematic = parent task name; real cross-discipline dependency edges import; Work→Duration
  effort fallback; resource assignments create/fuzzy-merge people; unmatched disciplines prompt an
  interactive mapping step (auto-skipped when every code matches by name) with an override always
  available; re-import is idempotent; another project's data is provably untouched even on a
  `jiraKey` collision.
- **Tests**: `tests/mppImport.test.ts` (pure parse layer, fixture modeled on the real file),
  `tests/applyMppImport.test.ts` (project-scoped reconciler, incl. the cross-project collision and
  idempotent-re-import cases), `tests/ui/mppImport.test.tsx` (drawer + mapping step via
  `ProjectDetail`). A full `.exe` walkthrough against the real sample file is a manual step (no
  browser/Electron automation in this environment).
- **Migration considerations**: none — writes through the existing repository functions only.

## Phase 7 — Collaboration backend (product-owner go/no-go before scheduling)

- **Objective**: per `COLLABORATION_MODEL.md`, build the row-version/optimistic-concurrency backend
  **only if** the product owner confirms multiple concurrent editors on the same plan file is an
  actual near-term need (as opposed to the current one-file-per-Producer model remaining acceptable
  for longer).
- **Files/components affected**: an entirely new server component (not part of the existing
  Electron/browser app) + a thin sync client added to `src/persistence/`.
- **Dependencies**: Phases 1-4 (schema should be reasonably stable before building sync against
  it — see `COLLABORATION_MODEL.md` §4's reasoning for sequencing this last).
- **Acceptance criteria**: TBD — depends entirely on the go/no-go decision and, if go, on further
  scoping not attempted in this document (deliberately — building this out fully now would violate
  the brief's own "avoid building infrastructure not needed by the current vertical slice"
  instruction).
- **Tests**: TBD.
- **Migration considerations**: adding `version`/`updated_at`/`updated_by` to the mutable tables
  identified in `COLLABORATION_MODEL.md` §3 — additive, low risk, but only worth doing once this
  phase is actually scheduled.

## Decisions requiring product-owner validation (collected from all documents)

Resolved 2026-09-18 directly with the product owner:

1. **Shared SQL backend (Phase 7)** — **not needed now.** Current one-file-per-Producer model stays
   acceptable while the domain model (Phases 1-4) stabilizes first. Phase 7 stays last/gated, as
   planned. (`COLLABORATION_MODEL.md` §1, §4)
2. **Real MS Project export / Jira access** — **MS Project resolved and shipped.** The discovery
   spike against the real `.mpp` sample (`NEW-OVR-MACRO-RELEASE-27.mpp`) is complete and Phase 6
   shipped on its findings (`INTEGRATIONS.md` §2.1-§2.5). Jira: no access exists yet, but the product
   owner can generate an API token on demand when Phase 5's discovery spike is scheduled.
   (`INTEGRATIONS.md` §3.1)
3. **Jira status vs. `LOQ.status`** — **confirmed: keep them separate.** Jira status is never
   allowed to overwrite `LOQ.status` directly; the two stay distinct values that get compared, per
   this document's recommendation. (`INTEGRATIONS.md` §3.2)
4. **Variance-category taxonomy (`PLANNING_ENGINE.md` §4.1)** — **validated as-is for now.**
   Re-confirmed 2026-09-18 with the product owner: keep the proposed categories as they stand: no
   further changes at this time. It may still evolve once the Productrice/AP team's actual working
   vocabulary surfaces through real usage.
5. **`scenarios` table repurposing** — **confirmed: keep separate.** `scenarios` stays reserved for
   a genuine what-if-planning feature; collaboration/local-edit isolation (if ever built in Phase 7)
   gets its own mechanism, not `scenarios`. (`COLLABORATION_MODEL.md` §5)
6. **Discipline Production Plan as computed rollup** — **resolved 2026-09-18.** Checked against the
   real `.mpp` reference file (`NEW-OVR-MACRO-RELEASE-27.mpp`): MS Project's own outline goes
   straight from Cinematic to Discipline×LOQ tasks, no intermediate "Discipline Production Plan"
   node — so this stays a computed/filtered view over `LOQ` (never a stored table), shaped like
   `Requirement`/`RequirementAllocation` so it can feed the existing top-down/bottom-up comparison
   (`getProjectDisciplineStaffing`) rather than becoming a separate screen. Whether it eventually
   replaces manually-entered `required` for LOQ-tracked disciplines, or sits alongside it as a
   cross-check, is left open for Phase 2 design — not a blocking product question.

   Also resolved, same session — the monthly aggregation rule: a LOQ's assigned effort must be
   derived strictly from real `loq_resources` assignment windows. A LOQ with no resource assigned
   contributes zero to every month; never a fallback spread across `committed_start`/
   `committed_finish` or `estimateDays`. Confirmed against a real example in the reference file:
   task `CIA_Safehouse-Anim-L2` (committed 2025-05-26 → 2026-06-26) was actually worked by two
   different people in two disjoint windows eight months apart, with nobody on it in between. No
   Cinematic-level status is needed to represent that gap — it's simply the absence of
   `loq_resources` coverage for that period. This means `loq_resources` needs a date range per
   resource row (today it's a single dateless `fte` per person) — tracked as a Phase 2 schema
   follow-up, not part of Phase 1's already-shipped schema. (`PRODUCT_MODEL.md` §4,
   `PLANNING_ENGINE.md` §1)

## What this plan deliberately does not include

No phase in this plan touches `src/ui/timeline/`, `src/ui/views/Dashboard.tsx`'s existing
capacity/occupancy visualizations, `src/import/rpmImport.ts`/`staffingImport.ts`, or any existing
`Requirement`/`PersonAssignment` behavior — all of that keeps working exactly as it does today
throughout every phase above, per the brief's "preserve working functionality" rule.
