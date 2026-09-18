# Product Model — Cinematic Production Planner

Status: **audit deliverable, not yet implemented**. This document normalizes the product/domain
vision from the mission brief against what the codebase actually does today (see
`ARCHITECTURE_AUDIT.md` for the evidence). Nothing here is built yet.

## 1. What the app is today, in one paragraph

CINE-ResourcePlanner is a **local-first, single-user capacity-planning tool**. It answers "do we
have enough discipline capacity (FTE) for what's coming, and where will we run out?" at **project
and monthly granularity**. There is no task/milestone concept, no day-level scheduling below the
project's own start/end dates, no dependency graph, no actual-vs-planned tracking, and no external
integrations. It is a very well-factored *capacity engine* with a UI wrapped around it — not yet a
production-scheduling tool.

## 2. What the target product adds

The target layers a **production-scheduling and execution-tracking system** on top of (not instead
of) the existing capacity engine:

```text
Portfolio                          — implicit today (one file = one portfolio); stays implicit
  └── Project                      — exists today, reusable as-is
       └── Cinematic               — NEW: does not exist in any form today
            └── Discipline Production Plan   — NEW, but should be a computed view, not a stored
                                                entity (see §4)
                 └── LOQ            — NEW: the biggest addition. Not the same thing as the
                                       existing `Requirement` (see §5)
                      ├── Resources — partially exists (`Person` + `PersonAssignment`), needs to
                                       be re-keyed to LOQ/Cinematic and given day resolution
                      ├── Schedule  — NEW: day-level committed/forecast/actual dates
                      └── Dependencies — NEW: nothing like this exists today
```

Layered on top of that hierarchy:

- **Committed → Reality → Forecast → Actual** state machine per LOQ (NEW).
- **Variance/deviation** events, attributable and justified (NEW).
- **Dependency-based forecast propagation**, with root-cause vs. downstream-impact distinction
  (NEW).
- **Jira** as the execution-state source of truth for LOQs (NEW — zero existing integration).
- **MS Project** as the initial committed-plan input, and eventually an export target (NEW — zero
  existing integration).
- **Shared/collaborative backend** instead of a single local SQLite file (NEW — today's storage is
  provably single-user; confirmed no separate SQL backend exists anywhere in the studio's tooling
  that this app could adopt).

## 3. Core entities (normalized)

| Entity | Definition | Status |
|---|---|---|
| Portfolio | The whole planning scope (today: one `.sqlite` file). | Implicit, no change needed for V1. |
| Project | A production/show. Has name, status, priority, start/end with certainty. | Exists (`projects` table), reusable as-is. |
| Cinematic | One sequence (occasionally several). The primary unit the target model plans at. | **New entity.** |
| Discipline | A department (Animation, Lighting, Comp, …). | Exists (`disciplines` table), reusable as-is. |
| Discipline Production Plan | The set of LOQs for one discipline within one Cinematic. | **Should be a computed rollup, not a stored table** — see §4. |
| LOQ | A production milestone/task, identified in Jira, with committed/forecast/actual dates, status, estimate, DoD reference. | **New entity**, structurally unlike anything in the current schema. |
| Resource (Person) | A named individual, optionally in a discipline/role (`ResourcePool`). | Exists (`people` table), reusable; needs LOQ/Cinematic-level assignment in addition to today's project-level assignment. |
| ResourcePool ("role") | A discipline's role bucket, carries aggregate monthly FTE capacity via its people. | Exists, reusable unchanged — this is the top-down capacity side and stays as-is. |
| Dependency | A hard (overridable) ordering constraint between two LOQs. | **New entity.** |
| Variance | An explicit, attributed, timestamped, justified deviation from the committed plan. | **New entity.** |
| Plan change log / snapshot | A record of who changed what, when, and why, for committed-plan changes. | **New entity** — nothing like this exists (no `updated_at`/`created_by`/version column anywhere in the schema). |
| Scenario | A named variant of the whole plan (what-if). | Exists as inert scaffolding (`scenarios` table, `scenario_id` FK on `Requirement`/`PersonAssignment`), only one row ever used. Candidate mechanism to repurpose — see `COLLABORATION_MODEL.md`. |

## 4. Correction to the brief: "Discipline Production Plan" should not be a stored entity

The brief's hierarchy places a "Discipline Production Plan" node between Cinematic and LOQ. The
codebase already has a precedent for exactly this situation: `getProjectDisciplineStaffing()`
(`src/engine/planning.ts:336-357`) rolls pool-level requirement/assignment rows up to
discipline granularity **on demand**, with no stored "discipline plan" table. The same pattern
should apply here: a Discipline Production Plan is just *"every LOQ for Cinematic X, Discipline Y"*
— a filtered/grouped view over `LOQ`, computed by the engine, not a row a user creates or a foreign
key anything points at. Storing it as a real entity would duplicate data that's already fully
derivable from `LOQ.cinematicId` + `LOQ.disciplineId`, and would reintroduce the kind of
two-sources-of-truth bug this codebase has already suffered from once (see `Project.status` vs.
`deriveProjectStatus()` in `ARCHITECTURE_AUDIT.md` §7.2).

## 5. Correction to the brief: LOQ is not a bigger `Requirement`

It would be tempting to read "LOQ" as "just add dates and a Jira key to `Requirement`." That is
wrong, and worth stating explicitly because it's the most consequential domain-modeling decision in
this whole exercise:

| | `Requirement` (today) | `LOQ` (target) |
|---|---|---|
| Grants meaning at | Project × discipline × **month** | Cinematic × discipline × **specific task** |
| Identity | None beyond its own row — fungible FTE demand | Jira issue key — a specific, named piece of work |
| Time resolution | Monthly FTE (a rate) | Day-level committed/forecast/actual **dates** (a task) |
| Lifecycle | None (a number that can be zero) | TODO → IN PROGRESS → DONE |
| Relationship to supply | Compared in aggregate against `PersonAssignment` FTE | Has resources *assigned to it directly* |
| Compared against | Nothing external | Jira's live execution state |

`Requirement`/`RequirementAllocation` answer *"how much capacity does discipline X need on project Y
in month M"* — a rate question. `LOQ` answers *"is this specific task going to finish on time, and
if not, why, and what does it affect"* — a task-identity and schedule question. These are
complementary, not the same axis, and the target model needs both:

- `Requirement` (top-down, monthly FTE) stays exactly as it is today — it answers the *portfolio
  capacity* question (brief §10 "top-down").
- `LOQ` (new, day-level, task-identity) answers the *production schedule* question and becomes the
  **bottom-up** source of Cinematic demand (brief §10 "bottom-up") — a Cinematic's LOQs, summed by
  discipline and month, are what should feed the "bottom-up demand" side of the capacity-conflict
  comparison, while `Requirement` continues to hold the "top-down required" side. The comparison
  itself (`Required vs. Demand → conflict`) is new engine logic, but it consumes two already-modeled
  or newly-modeled things rather than requiring a third.

## 6. Correction to the brief: "existing SQL database used more broadly" does not exist

Confirmed directly with the product owner during this audit, and independently by code
inspection: **there is no external/shared SQL database** for this planning domain. The only SQL in
play is this app's own `sql.js` (SQLite-via-WASM) file, which is provably single-user (see
`ARCHITECTURE_AUDIT.md` §3). "SQL as the canonical shared planning store" (brief §15) is therefore
not an evolution of existing infrastructure — it is **new infrastructure that has to be built from
scratch** (a real server-hosted database plus a sync protocol). This changes the risk profile of
that part of the brief significantly; see `COLLABORATION_MODEL.md`.

## 7. Non-goals carried forward unchanged

Everything the brief marks as a V1 non-goal (§20) is *also* already **absent from the current
app**, so no removal work is needed — only discipline to not add it back in accidentally while
building the new layers:

- No shot-level breakdown (confirmed: the deepest existing granularity is Project → Discipline →
  Pool → Person; nothing shot-shaped exists).
- No automatic resource reassignment or automatic committed-date mutation (the existing engine
  never writes back into `Requirement`/`PersonAssignment` on its own — every mutation is
  user-initiated through `useStore.ts` actions).
- No percentage artistic progress (LOQ status will be the simple TODO/IN PROGRESS/DONE enum from
  the brief, nothing else).
- No AI in the calculation path (the existing `engine/` layer is already 100% deterministic,
  DB/UI-free, and unit-tested this way — see `PLANNING_ENGINE.md`).

## 8. What the target model deliberately leaves open (flag for product owner)

- **Jira project/issue-type shape is unknown.** The brief itself says not to assume rich metadata.
  No code in this repo references Jira in any form. The LOQ↔Jira mapping in `DATA_MODEL.md` and
  `INTEGRATIONS.md` is therefore a *proposal to validate against a real Jira project*, not a
  confirmed design.
- **MS Project export shape is unknown.** No `.mpp`/MS-Project-XML handling exists anywhere in this
  codebase to inspect. The Duration-vs-Work question in the brief (§14) cannot be answered from the
  current code — it needs a real exported file from the studio's actual MS Project usage.
- **Whether a shared backend is in scope for the first vertical slice at all.** Given it's wholly
  new infrastructure (not an evolution), this is a genuine go/no-go decision for the product owner,
  not an engineering detail — see `IMPLEMENTATION_PLAN.md` Phase ordering.
