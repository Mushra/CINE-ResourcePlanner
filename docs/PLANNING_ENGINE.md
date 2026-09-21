# Planning Engine — Deterministic Rules (Proposal)

This document specifies the deterministic rules for the new LOQ-level planning engine. It follows
the existing `src/engine/` architecture (`ARCHITECTURE_AUDIT.md` §3): pure functions/classes over a
data snapshot, zero DB/UI dependency, unit-testable with hand-built fixtures exactly like
`tests/planning.test.ts` and `tests/validation.test.ts` do today. Nothing in this document is
implemented yet — this is the specification the implementation plan will build against.

## 1. Foundational rule: two time resolutions coexist on purpose

The existing capacity engine (`PlanningEngine` in `src/engine/planning.ts`) is monthly, aggregate,
and stays **exactly as it is** — it answers the top-down portfolio-capacity question and nothing in
this document changes its behavior. The new LOQ engine is day-level and task-identity-based. The two
meet at exactly one integration point:

> A Cinematic's LOQs, summed by discipline and month, become the **bottom-up demand** input to the
> existing top-down-vs-bottom-up capacity comparison (brief §10). This is new aggregation logic that
> *reads* LOQ data and *produces* numbers in the same shape `Requirement`/`RequirementAllocation`
> already use — it does not require changing the existing monthly engine at all.

This discipline+month rollup actually has two distinct inputs, kept separate: **demand** comes from
each LOQ's own `committed_start`/`committed_finish`/`estimate_days` and exists even with no resource
assigned yet; **assigned** comes strictly from `loq_resources` assignment windows (`DATA_MODEL.md`
§`loq_resources`) and is zero for any month a LOQ has no window covering it — never a spread over
the committed window as a fallback.

Do not attempt to collapse LOQ scheduling into the monthly `Period` string. LOQ dates are real ISO
dates; the monthly rollup is a derived view for the capacity-comparison purpose only.

### 1.1 Demand/assigned intensity rules (implemented)

`src/engine/loqRollup.ts::getCinematicDisciplineRollup()` implements both signals above. Neither is
prorated across months a window/committed range spans — the same flat-per-month intensity applies to
the first, middle, and last month it touches, matching how `RequirementAllocation`/
`PersonAssignmentAllocation` already treat `fte` as a flat monthly intensity rather than a
total-effort-days quantity to be redistributed.

- **Assigned**: the flat `loq_resources.fte` value, added to whichever month(s) its
  `[start_date, finish_date]` window touches. A window-less row (null dates) contributes 0 — never a
  fallback spread over the LOQ's committed window.
- **Demand**: intensity = `estimate_days / (working days in the committed window)`, Mon-Fri only,
  applied flat to every month `[committed_start, committed_finish]` touches. When `committed_finish`
  is null but `committed_start` and `estimate_days` are set, an implicit finish is derived as
  `committed_start + estimate_days` working days, for rollup placement only — never stored back to
  the LOQ. Demand is 0 when `committed_start` or `estimate_days` is missing, or the resulting window
  has no working days.

This mirrors MS Project's own implicit model: a task has no stored "units"/FTE field, only `Work`
(total effort) and `Duration` — the effective intensity is `Work ÷ Duration`. Confirmed against a real
example (`CIA_Safehouse-Anim-L2`, `NEW-OVR-MACRO-RELEASE-27.mpp`): ~424.15h total work over 102
working days ≈ 0.5 FTE, matching the usual 0.5/1/2 FTE values production actually assigns.

This is a computed signal with no consumer yet — the `capacity_conflict_cinematic` sanity check that
will read it (§8) stays a later, separate slice.

## 2. State model per LOQ

Every LOQ carries four date-bearing states, matching brief §5 exactly:

```text
COMMITTED  →  CURRENT REALITY  →  FORECAST  →  ACTUAL
```

| State | Stored or computed? | Who/what sets it | Mutability rule |
|---|---|---|---|
| **Committed** | **Stored.** | A human, explicitly, via a "re-commit" action. | Never changes silently. Every change is a new, timestamped, attributed, justified event — see §4. |
| **Current reality** | Not a stored field — it's just "the current state of everything else" (Jira status, dependency chain, declared variances) at the moment you look. | N/A | N/A |
| **Forecast** | **Computed, always.** Never a field a human edits directly. | The forecast function (§5), recomputed on read from committed + variances + dependency propagation + Jira state. | Cannot drift from its inputs by construction, because it is never itself a source of truth. |
| **Actual** | **Stored**, but only ever written by the Jira sync adapter (or explicit "mark done" if no Jira link exists), never by a planning user editing a date field. | Jira completion date, or explicit manual completion. | Immutable once set, except by re-sync if Jira's own actual date changes (itself logged as a variance-adjacent event, not a silent overwrite). |

> **V1 shortcut, closed (`feature/cinematic-production-planner`, `loq_events` commits 1-6, on top of
> `loq_ui` 1-7):** the earlier direct `updateLoq` write for committed dates has been replaced by a real
> `recommitLoq` store action (§3) that writes an append-only `loq_commitment_events` row and updates
> the LOQ's denormalized cache in the same call. `LoqFormDrawer` no longer exposes committed-date
> inputs at all; a "Re-commit dates…" button opens the dedicated `RecommitDialog`, which also shows the
> LOQ's commitment history. **`computeForecast()` (§5) and dependency-delay propagation (§6) are now
> also shipped** (`loq_forecast` 1-4) — a LOQ's committed date (from `recommitLoq`) remains the stored,
> human-set baseline; forecast is a separate, always-computed read layered on top, never itself
> written back.

### Why forecast must be computed, not stored-and-edited

This is the single most important rule in this document, and it is directly evidenced by a real bug
already in this codebase: `Project.status` is a *stored* field that a human/import can set, but
`deriveProjectStatus()` *computes* the authoritative value live from dates, and the two can silently
disagree (`ARCHITECTURE_AUDIT.md` §8.3). If `LOQ.forecastDate` were a stored, directly-editable
field, it would face the exact same failure mode: a user could set it once, then the underlying
committed date / variance / dependency chain changes, and the stored forecast quietly goes stale
with no code path forcing it back into agreement. Making forecast a pure function of its inputs, recomputed on every read, makes that class of bug structurally impossible — there is only ever one
source of truth for "when do we currently think this finishes."

## 3. Committed-date changes: the overlay pattern, generalized

> **Shipped** (`loq_events` commits 2-3): `useStore.recommitLoq(loqId, { committedStart,
> committedFinish, reason, comment })` writes a `loq_commitment_events` row (via
> `createLoqCommitmentEvent`) stamped with the current producer-name preference (§ attribution, below)
> as `changedBy`, then updates the LOQ's `committedStart`/`committedFinish` cache — the same call, so
> the two can't diverge. `RecommitDialog` is the only UI path to a committed-date change; it lists the
> LOQ's full commitment history (newest first) alongside the edit fields. Attribution in this slice is
> a single global producer-name preference (`useUiStore`, localStorage-backed), not a per-user login —
> good enough for "who/when/why," not yet a real auth identity.

`src/domain/overrides.ts` already proves the exact mechanism the committed plan needs: a baseline
that is never silently mutated, layered with named, resolvable overrides, applied once centrally
before anything downstream consumes the data (`ARCHITECTURE_AUDIT.md` §2). Generalizing it to
committed dates:

- The "baseline" is the most recent explicit commitment for a LOQ (initially: whatever MS Project
  import set).
- **Re-committing** a LOQ's date is not an in-place `UPDATE` — it is an explicit event: who, when,
  old committed date, new committed date, justification/comment. The LOQ's *current* committed date
  is simply "the newest such event for this LOQ" — the same shape as `structure_overrides`
  resolving to "the newest/most specific override for this key," just append-only instead of
  upsert-in-place (append-only is required here because, unlike a structural override, we need the
  *history* of commitments, not just the current one — see §7).
- This directly satisfies brief §5's "must never silently adapt the committed plan to reality" and
  §9's "committed date remains unchanged... user can explicitly change the committed plan, but that
  modification must be traceable and justified" in one mechanism.

## 4. Variance rules

> **Shipped** (`loq_events` commit 4): `useStore.declareVariance(loqId, { category, expectedFinish,
> comment })` writes a `variance_events` row (via `createVarianceEvent`), computing
> `committedDateAtDeclaration` (`committedFinish ?? committedStart`), `forecastDateAtDeclaration`
> (= the producer's manually-entered `expectedFinish` — `computeForecast()` per §5 is not implemented
> yet, so this is captured by hand rather than derived), and `deltaDays` = `isoDiffDays(committed,
> expected)`, once, at declaration time, never recomputed. `VarianceDialog` is the entry point (a
> "Variance" action on each LOQ row) and also lists the LOQ's declared-variance history. The §4.1
> taxonomy ships as `VARIANCE_CATEGORIES` (`src/domain/variance.ts`); `VarianceCategory` stays `string`
> so the list can grow without a migration.

A variance is a declared, attributed explanation for why forecast differs from committed. It is
**not** the same record as a re-commitment (§3) — a variance explains a gap without changing the
committed baseline; a re-commitment changes the baseline itself (and should typically be preceded by
one or more variances that made the old committed date untenable).

Required fields, straight from brief §6:

```text
loq_id, category (enum, §4.1), reason_comment (free text, optional),
declared_by, declared_at,
committed_date_at_declaration, forecast_date_at_declaration, delta_days (computed, signed)
```

`delta_days` is computed and stored at declaration time (not recomputed later) because it needs to
answer "how many days did we lose, and when did we know it" even after the committed date is later
changed — this is what makes the "how many days did we lose, why, how often" analytics questions
(brief §6) answerable without replaying history.

### 4.1 Variance category taxonomy (proposal)

Starting directly from the brief's suggested list, normalized into a flat enum (no sub-categories —
keep it simple until real usage shows a need for more structure):

```text
SICK_LEAVE_ABSENCE
TECHNICAL_ISSUE
PRODUCTION_BLOCKER
CLIENT_DIRECTION_CHANGE
SCOPE_CHANGE
EXTERNAL_DEPENDENCY
WAITING_FOR_VALIDATION
RESOURCE_UNAVAILABLE
ESTIMATION_ISSUE
PRIORITY_CHANGE
OTHER
```

This taxonomy is a proposal to validate with the Productrice/APs (brief's own instruction) — it is
deliberately flat and deliberately not implemented yet, but it is the shape the `variance_reasons`
table/enum in `DATA_MODEL.md` assumes.

**Validated as-is for now** (product owner, 2026-09-18) — no changes to the list above; it may still
evolve once the AP team's working vocabulary surfaces through real usage.

### 4.2 Early completion is also a variance-shaped event, but never auto-applied

Brief §8 requires detecting "Lighting L1 could start 2 days earlier" without moving it
automatically. Model this as a **computed flag**, not a stored variance: whenever a LOQ's actual (or
forecast) completion is earlier than committed, and a downstream LOQ depends on it, the engine
surfaces an "early-completion opportunity" (see §6) that a human can act on by *choosing* to
re-commit the downstream LOQ. Nothing writes to the downstream LOQ's committed date on its own.

## 5. Forecast computation

> **Shipped** (`loq_forecast` commit 1, `src/engine/loqForecast.ts::computeForecasts`). The signature
> ended up simpler than this section originally proposed: `computeForecasts(loqs, dependencies,
> varianceEvents)` — no `jiraState` parameter. There is no Jira integration yet, so rule 1 reads the
> LOQ's own `actualFinish`/`status === 'DONE'` fields directly; a future Jira sync only needs to write
> those same fields for rule 1 to pick it up unchanged. Two rules below are **deliberately refined**
> from the wording as originally written here — both documented at the top of `loqForecast.ts` and
> covered by `tests/loqForecast.test.ts`:
> - **Rule 2 refinement**: "sum of undismissed variance deltas" is not what's implemented, because
>   the shipped `VarianceEvent.deltaDays` (`declareVariance`, §4) is an **absolute** snapshot — the
>   delta vs. the committed date *at declaration time* — not an incremental delta. Summing multiple
>   variances would double-count the same slip. The implemented rule instead takes the **latest**
>   variance's `forecastDateAtDeclaration` per LOQ: the producer's most recently stated reality wins,
>   superseding earlier variances rather than stacking with them.
> - **Rule 3 refinement**: propagation shifts a successor's window by its predecessor's resolved
>   `deltaDays` only — `lagDays` is *not* added to the shift magnitude, even though lag is a real field
>   on the dependency edge. Lag is a static gap already baked into the successor's own `committedStart`
>   when the schedule was originally built; adding it again on top of the predecessor's slip would
>   double-shift the successor.
>
> Deltas are calendar days (`isoDiffDays`), matching how variance `deltaDays` was already computed —
> only the committed *baseline* itself uses working-day math (`loqEffectiveFinish`, §1.1).

`computeForecasts(loqs, dependencies, varianceEvents)` — pure function, deterministic, no AI (brief
§19). Rules, in priority order:

1. **If the LOQ's `actualFinish` is set**, forecast = that date (the LOQ has already happened;
   forecast and actual converge). `source: 'actual'`.
2. **Else if the LOQ has a declared variance**, forecast = the latest variance's
   `forecastDateAtDeclaration` (see refinement above). `source: 'variance'`.
3. **Else if an upstream `finish_to_start` predecessor's forecast has moved** relative to *its own*
   committed date, propagate: this LOQ's forecast shifts by the predecessor with the largest-magnitude
   delta (see refinement above), unless this LOQ itself already resolved via rule 1 or 2 (a LOQ's own
   declared reality always wins over inherited propagation). `source: 'propagated'`.
4. **Else** forecast = committed date, delta 0. `source: 'committed'`.

This function is idempotent and side-effect-free: calling it twice with the same inputs gives the
same output, and it never writes anything back into `committed_date` or `variance` records — it only
ever *reads* those and produces a forecast value for display. `PlanningEngine.getLoqForecasts()`
computes the whole graph once per engine instance and caches it (`planning.ts`); a fresh
`PlanningEngine` is constructed on every store mutation, so the cache can never go stale.

## 6. Dependency propagation and root-cause attribution

> **Shipped** (`loq_events` commit 5 for DAG enforcement + CRUD; `loq_forecast` commits 1 and 3 for
> propagation and root-cause attribution). Dependency CRUD
> (`createLoqDependency`/`updateLoqDependency`/`deleteLoqDependency` in `useStore.ts`) and the cycle
> check below are wired to a `LoqDependencyEditor` section on the Cinematic detail view.
> `computeForecasts` (§5) now walks these edges to propagate a predecessor's delta to its successor,
> and tracks `rootCauseLoqId` inline during that same walk (a LOQ's own variance/`actualFinish` makes
> it its own root cause; a purely-propagated LOQ inherits the root cause of whichever predecessor drove
> its max-magnitude delta). `impactedLoqIds(rootCauseLoqId, forecasts)` is the reverse lookup the
> `loq_root_cause` check (§8) uses to name every downstream-impacted LOQ.
>
> **Nested "one root cause / N impacts" view shipped** (`loq_impact_ux` commits 1-2). `SanityCheck`
> carries structured correlation data now — `loqId` on `loq_at_risk`/`loq_root_cause`/
> `loq_early_opportunity`, and `impacted: { loqId, label, deltaDays }[]` on `loq_root_cause` — so the
> Dashboard (`src/ui/views/Dashboard.tsx`) can suppress the flat `loq_at_risk` row for the root LOQ
> itself and every LOQ in its `impacted` list, and render them instead as a nested list under the
> `loq_root_cause` row. A predecessor slip on a chain now surfaces as **one** incident with its
> downstream impact nested beneath it, not N separate flat rows. `loq_root_cause`'s `impact` string is
> unchanged (still text, for the Excel export); the nesting is presentation-only, built from the new
> structured fields. `loq_early_opportunity` stays flat — it's an info-level flag, not a delay incident.
>
> The shipped scope is also narrower than this section's full design: edges are **within a single
> Cinematic only** (cross-Cinematic edges deferred), `type` is always `'finish_to_start'` (not yet
> exposed as a choice even though the field allows it), `source` is always `'override'` (templates —
> §6.1 — unbuilt), and `overridden` is not on the type/schema at all (still no consumer for it).

Brief §7 explicitly warns against reporting a propagated delay as N independent incidents. Rule:

- Dependencies form a **DAG** (enforced at write time — reject any edge that would create a cycle;
  do not build a general constraint solver, a simple "would adding this edge make the target
  reachable from the source already" check on the existing adjacency list is sufficient for the
  LOQ-count this product will ever have). **Shipped as `wouldCreateCycle()` in
  `src/domain/loqGraph.ts`**: a reachability walk from the proposed successor forward through existing
  edges, checking whether it reaches the proposed predecessor (or is a self-loop) — exactly the "simple
  reachability, not a constraint solver" rule this bullet asks for.
- Each dependency edge has: `predecessor_loq_id`, `successor_loq_id`, `type` (only `finish_to_start`
  in V1 — brief doesn't ask for more), `lag_days` (default 0), `source` (`'template'` or
  `'override'` — see §6.1), `overridden` (boolean).
- **Root-cause attribution rule**: a forecast delta on a LOQ is attributed to a variance declared
  *on that LOQ itself*. Any LOQ whose forecast delta is fully explained by an upstream propagation
  (i.e., it has no variance of its own, and its forecast delta equals its upstream predecessor's
  forecast delta) is **not** a root cause — it is downstream impact. The dashboard/attention-points
  view (§8) must walk the dependency chain backwards from any delayed LOQ until it finds the nearest
  ancestor that *does* have its own variance (or no upstream dependency at all, meaning the delay
  originates there) and present that as the single root cause, with everything downstream of it
  listed as impact — never as separate incidents.
- **Early completion** uses the identical propagation direction, just with a negative delta, and per
  §4.2, is surfaced as an opportunity, never auto-applied.

### 6.1 Dependency templates and per-Cinematic overrides

Brief §12 asks for dependencies to be reusable via discipline/LOQ templates with per-Cinematic
overrides. Keep this simple:

- A `dependency_template` is just a dependency edge defined between two *LOQ types* (e.g.
  "Animation L1 → Lighting L1") scoped to a discipline pairing, not to any specific Cinematic.
- When a Cinematic's LOQs are created (from a Jira sync or a template application), any matching
  template edges are materialized as real `loq_dependencies` rows with `source = 'template'`.
- A per-Cinematic override is simply another `loq_dependencies` row with `source = 'override'` that
  either replaces or removes the templated edge for that Cinematic only — the template rows
  themselves are never mutated by a per-Cinematic change, same overlay principle as §3.

## 7. History requirement

Every commitment event (§3) and every variance (§4) is already, by construction, an append-only
record with who/when/old/new/reason. That satisfies brief §16's "why was this date different last
week?" question directly, without needing a separate generic snapshot mechanism: the answer to
"what was the committed date on 2026-09-01" is "the newest commitment event for this LOQ with
`declared_at <= 2026-09-01`." No full-plan snapshotting is needed for V1 — only append-only event
logs on the two things that actually change (commitments, variances). See `DATA_MODEL.md` for the
exact table shapes and `COLLABORATION_MODEL.md` for how this interacts with concurrent local edits.

## 8. Attention/actionability rules (extends the existing sanity-check engine)

New `SanityCheck`-style categories, added the same way the README already documents extending
`validation.ts` ("add a checker function... append to `getSanityChecks`"):

- `loq_at_risk` (warning/critical by how large the forecast-vs-committed delta is) — **implemented**
  (`src/engine/validation.ts::checkLoqAtRisk`). A LOQ whose forecast has slipped past its committed
  date and is not yet DONE; critical past a 5 calendar-day slip (an explicit, simple threshold — not
  a heuristic, per §9), warning otherwise.
- `loq_root_cause` (critical) — **implemented** (`checkLoqRootCause`). A LOQ carrying its own variance
  (or an `actualFinish` past committed) that is the root cause of at least one downstream impact (per
  §6), surfaced once per root cause, with its downstream chain named in `impact` and, since
  `loq_impact_ux`, also carried structurally in `impacted` for the Dashboard's nested rendering — the
  impacted LOQs' own `loq_at_risk` rows (and the root's) are suppressed from the flat list rather than
  shown as separate checks.
- `loq_early_opportunity` (info) — **implemented** (`checkLoqEarlyOpportunity`). A LOQ whose
  forecast/actual beat its committed date and has a downstream dependent that could, if a human
  chooses, be pulled earlier (§4.2) — a flag only, nothing is ever applied automatically.
- `jira_inconsistency` (warning/critical depending on direction — see `INTEGRATIONS.md` §3 for the
  specific inconsistency cases) — planning state disagrees with Jira's reported state. **Still
  deferred** — gated on a Jira sync existing at all.
- `capacity_conflict_cinematic` (critical) — **implemented** (`src/engine/validation.ts::checkCinematicCapacityConflict`,
  reading `src/engine/planning.ts::PlanningEngine.getProjectLoqDemand`, which sums
  `loqRollup.ts::getCinematicDisciplineRollup` across every Cinematic of a project). `Requirement` is
  provisioned per-project, not per-Cinematic, so the comparison is project-summed LOQ demand vs. that
  project's `Requirement`, per discipline/month — never demand vs. `assigned` (the integration point
  described in §1). Runs over the union of the project's Requirement-active months and its LOQs'
  demand months (`loqDemandPeriods`), so a demand month with zero Requirement coverage is still
  caught. Flat critical severity, no priority tiering — matches `over_capacity`.

All five follow the same pattern: pure functions reading a snapshot, returning `SanityCheck[]`,
sortable by severity, surfaced in the Dashboard's existing "Needs attention" panel with zero new UI
mechanism required. `ValidationRulesDialog.tsx`'s `RULES` array documents each one for end users, kept
in sync with `CheckCategory` by `tests/validationRulesDialog.test.ts`.

## 9. Explicit non-rules (do not build these)

- No percentage-complete interpolation from elapsed time on an IN PROGRESS LOQ (brief §4). Status is
  exactly TODO/IN PROGRESS/DONE; forecast slip must come from Jira state, dependency propagation, or
  a declared variance — never from "it's been open for X days, therefore Y% done."
- No automatic resource reassignment, no automatic committed-date mutation, no critical-path/float
  scheduling engine (a simple forward-propagation walk over a DAG is sufficient — see §6).
- No AI/ML anywhere in `computeForecast`, propagation, or the sanity checks above (brief §19). AI may
  summarize the *output* of these functions later, but never participates in producing it.
