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

## Phase 4 — Dependency-impact UX (root cause vs. downstream impact)

- **Objective**: surface brief §7's "one root cause, N downstream impacts" view, reusing the
  Dashboard's existing severity-grouped "Needs attention" panel rather than building a new visual
  language.
- **Files/components affected**: `src/ui/views/Dashboard.tsx` (new grouping for
  `loq_root_cause`/impact chain), possibly a small new `src/ui/components/ImpactChain.tsx` if the
  existing issue-row rendering can't express a nested chain cleanly.
- **Dependencies**: Phase 3.
- **Acceptance criteria**: a manually-constructed three-LOQ dependency chain with one declared
  variance shows exactly one root-cause entry with two impacted LOQs listed under it, not three
  separate issue rows.
- **Tests**: extend `tests/loqValidation.test.ts` fixtures to cover the three-LOQ chain case
  end-to-end through `getSanityChecks()`.
- **Migration considerations**: none.

## Phase 5 — Jira read adapter (discovery-gated)

- **Objective**: per `INTEGRATIONS.md` §3, but **only after** the discovery spike against a real
  Jira project has happened.
- **Files/components affected**: `src/import/jiraSync.ts` (new, parse/normalize step),
  `src/db/applyLoqSync.ts` (new, apply step, mirroring `applyImport.ts`'s shape), `jira_sync_state`
  repository functions, new `jira_inconsistency` wiring already stubbed in Phase 2.
- **Dependencies**: Phase 3 (needs LOQs to sync against); the discovery spike in
  `INTEGRATIONS.md` §4 step 1, which is a **prerequisite research task, not an engineering task**,
  and should be scheduled explicitly rather than assumed to happen implicitly during this phase.
- **Acceptance criteria**: TBD pending discovery spike findings — cannot be written precisely yet;
  placeholder until real Jira structure is known.
- **Tests**: fixture-based tests against a captured real (or realistically-shaped) sample of Jira
  API responses, once available.
- **Migration considerations**: none beyond Phase 1's `jira_sync_state` table.

## Phase 6 — MS Project import adapter (discovery-gated)

- **Objective**: per `INTEGRATIONS.md` §2, same discovery-gating caveat as Phase 5.
- **Files/components affected**: `src/import/mppImport.ts` (new), reusing the existing
  parse→normalize→apply shape and the existing `ImportDrawer`/`ImportReport` UI pattern rather than
  inventing a new import UX.
- **Dependencies**: Phase 1 (schema), Phase 3 (something to import into); the sample-file discovery
  step in `INTEGRATIONS.md` §2.1.
- **Acceptance criteria**: TBD pending a real sample file.
- **Tests**: fixture-based, once a real (or anonymized) sample export is available, following
  `tests/rpmImport.test.ts`'s pattern (build a workbook/XML in-memory, assert the parsed+applied
  result).
- **Migration considerations**: none.

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
2. **Real MS Project export / Jira access** — **partially resolved.** A real `.mpp` sample
   (`NEW-OVR-MACRO-RELEASE-27.mpp`) is now available from the product owner (see `INTEGRATIONS.md`
   §2.1 update) — Phase 6's discovery spike can start whenever scheduled. Jira: no access exists yet,
   but the product owner can generate an API token on demand when Phase 5's discovery spike is
   scheduled. (`INTEGRATIONS.md` §2.1, §3.1)
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
