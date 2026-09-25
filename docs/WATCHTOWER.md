# Cinematic Watchtower — Production View Integration

This documents the integration of the reference prototype `Cinematic Watchtower — Unified
Prototype.html` into the existing app. Three sources of truth were reconciled: the prototype is
the **UX/UI source of truth**, the existing engine/data is the **functional source of truth**, and
RPM/MS Project/Jira are the **external data source of truth**. Nothing in this iteration mocks
data — every screen either reads real engine state or explicitly discloses that it can't yet
(§4).

## 1. Where it lives

Opening a project (`ProjectDetail.tsx`) now shows a header (unchanged: name, derived status pill,
dates, edit/delete, warnings) followed by a **Production | Staffing** switch
(`useUiStore.projectView`):

- **Staffing** — the pre-existing requirement/assignment timeline, extracted verbatim into
  `src/ui/views/watchtower/StaffingView.tsx`. Behavior is unchanged from before this work.
- **Production** — the prototype's two screens, wired to real data, switched via
  `useUiStore.productionScreen`:
  - **Control Room** (`src/ui/views/watchtower/ControlRoom.tsx`) — health strip, attention panel,
    LOQ delivery outlook, current LOQ distribution.
  - **Cinematics Matrix** (`src/ui/views/watchtower/CinematicsMatrix.tsx`) — one row per
    Cinematic, one column per discipline, plus cinematic creation/import/Jira-sync (migrated here
    from the old Cinematics card, since this is now the cinematics list).

Both Production screens are driven by pure selectors in `src/engine/watchtower.ts`, which compose
`PlanningEngine` + `getSanityChecks()` — no new stored state, no `db` writes. This mirrors the
existing "derive, never store" precedent (`domain/projectStatus.ts::deriveProjectStatus`).

Drilling into a Cinematic still opens the existing `CinematicDetail.tsx` unchanged (per this
iteration's "reuse existing editors" decision), with one addition: a collapsed **"Not yet
integrated"** card (§4).

## 2. Mapping table (prototype element → engine capability)

| Prototype element | Classification | Real source |
|---|---|---|
| Control Room health strip (Ahead/On Track/At Risk/Blocked/Late) | Partially available | `deriveLoqHealth()` from `LoqForecast.deltaDays` + `Loq.status`/`paused` |
| Attention Required (problem/impact/source/priority) | Existing but different | `getSanityChecks()` filtered to the project; category → source, severity/health → priority |
| LOQ Delivery Outlook (dots by target) | Existing | `LoqForecast.forecastFinish` (falling back to `committedFinish`/`actualFinish`) vs. `Cinematic.targetDate` |
| Current LOQ Distribution (L1/L2/L3 bars) | Existing | `Loq.type`, counted per representative LOQ |
| Cinematics Matrix (one cell per discipline) | Existing but different | `representativeLoq()` adapter per (cinematic, discipline) |
| CIN/LOQ status (Planned/In Progress/On Hold/Done) | Existing but different | `Loq.status` (`TODO`/`IN_PROGRESS`/`DONE`) + `Loq.paused` → "On Hold" |
| LOQ level L1/L2/L3 | Existing | `Loq.type` (free text) |
| Cinematic Detail / LOQ Detail / dependencies / recommit / variance / Jira link | Existing | reused `CinematicDetail.tsx` unchanged |
| Video player, version push history, QA bug counts, Hotlines | **Not available** | no ShotGrid/Flow, QA, or Hotline integration exists — explicit "Not available yet" (§4) |

## 3. Derivation rules

### 3.1 `deriveLoqHealth(loq, forecast): WatchtowerHealth`

`WatchtowerHealth = 'ahead' | 'on-track' | 'at-risk' | 'blocked' | 'late'`. In order:

1. `loq.paused` → **blocked** (a manual production hold always wins, regardless of schedule).
2. Else by `forecast.deltaDays` (forecast finish vs. committed finish; same sign convention as
   `LoqForecast`):
   - `deltaDays >= 5` → **late** (matches the existing `loq_at_risk` critical threshold).
   - `deltaDays > 0` → **at-risk**.
   - `deltaDays < 0` → **ahead**.
   - `deltaDays === 0` (or no forecast) → **on-track**.

This is one documented, tunable function — the threshold of 5 is intentionally kept in sync with
`getSanityChecks`'s `loq_at_risk` category so "late" in Watchtower and "critical" in the sanity
checks agree on the same LOQ.

### 3.2 `representativeLoq(loqs, cinematicId, disciplineId): Loq | null`

Each Cinematic×Discipline cell/column shows exactly one LOQ (the schema allows several per
discipline over a cinematic's life — L1, L2, L3, …). Preference order:

1. The `IN_PROGRESS` one, if any.
2. Else the earliest non-`DONE` one by `committedStart` (the next thing due).
3. Else the most recently `DONE` one (nothing left to do, show the last delivered state).

### 3.3 `cinematicHealth` / `healthCounts`

A Cinematic's overall health is the **worst** health among its active disciplines' representative
LOQs, using severity order `blocked > late > at-risk > on-track > ahead` (matches the prototype's
`HORDER`). `healthCounts()` buckets every (Cinematic × Discipline) cell with a representative LOQ
by health — this is what the Control Room's health strip tiles count, not a count of Cinematics.

### 3.4 `cinematicStatus(cinematicId, disciplineIds, loqs): CinematicOverallStatus | null`

Rolls every discipline's representative LOQ up into one Cinematic-level status. Precedence (first
match wins), mirroring the prototype's `cinStatus()`:

1. **On Hold** — any active discipline's representative LOQ is `paused`.
2. **In Progress** — any active discipline's representative LOQ is `IN_PROGRESS`.
3. **Planned** — any active discipline's representative LOQ is `TODO`.
4. **Done** — otherwise (every active discipline is `DONE`).

`null` when the Cinematic has no LOQs at all yet (nothing to roll up).

### 3.5 `worstDiscipline(cinematicId, disciplineIds, loqs, forecasts): string | null`

The discipline whose representative LOQ is in the worst health for a given Cinematic — the
"bottleneck" discipline. Used by the Cinematics Matrix's **Group by: Discipline**, which groups
each Cinematic under its bottleneck discipline rather than splitting rows per discipline (confirmed
against the prototype's `worstDiscipline` field in `genCin()`, not guessed).

### 3.6 Attention panel filtering (`projectAttention` / discipline-specific health)

The Control Room's health-strip tiles filter the Attention panel **by the specific discipline named
in each attention item**, not by the Cinematic's overall/worst health — confirmed against the
prototype's `disciplineHealthOf(cinId, disc)`. A Cinematic can appear once for its "blocked" VFX
LOQ and, if the Health filter is "on-track", not appear at all for an unrelated on-track Anim LOQ.

### 3.7 LOQ Delivery Outlook date window

The prototype uses fixed small integer day-offsets from a mock "today". Real committed/forecast
dates span much wider, data-dependent ranges, so the outlook instead computes an actual date window
from the data: `minDate`/`maxDate` across every plotted date (LOQ dates + Cinematic target dates),
padded by `max(2, round(totalDays * 0.08))` days on each side. This is a deliberate adaptation of
the prototype's UX to real (wider, uneven) date ranges — same visual idiom, different windowing math.

## 4. Explicit gaps (never mocked)

Per this iteration's binding decision ("Un-backed UI renders explicit 'Not available yet' text
naming the needed API integration — never mock"), the following prototype capabilities have zero
backing code today and are disclosed as such rather than faked:

- **Video/version player** — needs a ShotGrid/Flow connector to fetch and stream published review
  versions.
- **Version push history** — needs a ShotGrid/Flow connector exposing the publish/push event log.
- **QA bug counts** — needs a QA bug tracker integration (e.g. ShotGrid Notes/Tickets, or a
  dedicated bug DB); no domain model exists yet.
- **Hotlines** — needs a Hotline/escalation feed integration; no domain model exists yet.

These are listed in `CinematicDetail.tsx`'s "Not yet integrated" card, each labeled with the
specific integration it needs (`src/ui/views/CinematicDetail.tsx::INTEGRATION_GAPS`).

The prototype's "Mocap Batch" grouping in the Cinematics Matrix is omitted outright (not even
disclosed as a gap) since there is no batching concept anywhere in this schema to attach it to.

## 5. Future engine roadmap

Not built in this iteration; tracked here for the next one:

1. **Staffing (RPM %) ↔ Production (LOQ-level) reconciliation** — Staffing and Production are
   currently two independent views over the same project with no cross-check (e.g. "this
   discipline is staffed at 40% but has an `IN_PROGRESS` LOQ due in 3 days"). No engine support
   exists for this; it needs a new reconciliation selector, not a UI-only fix.
2. **ShotGrid/Flow connector** — version player + push history. Zero existing references anywhere
   in the codebase; needs a new adapter following the same shape as the MPP/Jira integrations
   (`docs/INTEGRATIONS.md` §1: parse → normalized DTO → reconcile against domain tables).
3. **QA bug tracking + Hotlines** — no domain model, no integration. Needs its own schema
   (something like `qa_bugs`, `hotlines` tables) before any UI beyond the current disclosure card
   is meaningful.
4. **Jira live HTTP client (Phase 5b)** — the current Jira integration is a manual `.json` bridge
   (Phase 5a); a live client is scoped but not yet built (see `project_cinematic_production_planner`
   memory / `IMPLEMENTATION_PLAN.md`).
5. **Full prototype-fidelity restyle of Cinematic/LOQ detail** — this iteration reused
   `CinematicDetail.tsx` unchanged by explicit decision; a later pass could bring its visual
   language in line with the Watchtower Production screens.
