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

`computeForecast(loq, allLoqs, dependencies, variances, jiraState)` — pure function, deterministic,
no AI (brief §19). Rules, in priority order:

1. **If Jira reports the LOQ DONE**, forecast = actual completion date from Jira (the LOQ has
   already happened; forecast and actual converge).
2. **Else if the LOQ has open variances that push its own finish date**, forecast = committed date +
   sum of undismissed variance deltas for this LOQ (a variance's `delta_days` is the *known* slip at
   declaration time; multiple variances on the same LOQ accumulate).
3. **Else if an upstream dependency's forecast has moved** (later or earlier) relative to *its own*
   committed date, and this LOQ has a `finish-to-start` dependency on it, propagate: this LOQ's
   forecast start shifts by the same delta as the upstream LOQ's forecast-vs-committed delta, unless
   this LOQ itself already has its own variance/forecast override (a LOQ's own declared reality always
   wins over inherited propagation — never let an upstream shift silently erase a downstream team's
   own better information).
4. **Else** forecast = committed date (no known reason to expect otherwise).

This function must be idempotent and side-effect-free: calling it twice with the same inputs gives
the same output, and it must never write anything back into `committed_date` or `variance` records —
it only ever *reads* those and produces a forecast value for display.

## 6. Dependency propagation and root-cause attribution

Brief §7 explicitly warns against reporting a propagated delay as N independent incidents. Rule:

- Dependencies form a **DAG** (enforced at write time — reject any edge that would create a cycle;
  do not build a general constraint solver, a simple "would adding this edge make the target
  reachable from the source already" check on the existing adjacency list is sufficient for the
  LOQ-count this product will ever have).
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

- `loq_at_risk` (warning/critical by how large the forecast-vs-committed delta is) — a LOQ whose
  forecast has slipped past its committed date and is not yet DONE.
- `loq_root_cause` (critical) — a LOQ carrying its own variance that is the root cause of at least
  one downstream impact (per §6), surfaced once, with its downstream chain attached as `impact`
  rather than as separate checks.
- `loq_early_opportunity` (info) — a LOQ whose forecast/actual beat its committed date and has a
  downstream dependent that could, if a human chooses, be pulled earlier (§4.2).
- `jira_inconsistency` (warning/critical depending on direction — see `INTEGRATIONS.md` §3 for the
  specific inconsistency cases) — planning state disagrees with Jira's reported state.
- `capacity_conflict_cinematic` (critical) — bottom-up Cinematic-level LOQ demand for a
  discipline/month exceeds the existing top-down `Requirement` for that discipline/month (the
  integration point described in §1).

All five follow the existing pattern exactly: pure functions reading a snapshot, returning
`SanityCheck[]`, sortable by severity, addable to the Dashboard's existing "Needs attention" panel
with zero new UI mechanism required.

## 9. Explicit non-rules (do not build these)

- No percentage-complete interpolation from elapsed time on an IN PROGRESS LOQ (brief §4). Status is
  exactly TODO/IN PROGRESS/DONE; forecast slip must come from Jira state, dependency propagation, or
  a declared variance — never from "it's been open for X days, therefore Y% done."
- No automatic resource reassignment, no automatic committed-date mutation, no critical-path/float
  scheduling engine (a simple forward-propagation walk over a DAG is sufficient — see §6).
- No AI/ML anywhere in `computeForecast`, propagation, or the sanity checks above (brief §19). AI may
  summarize the *output* of these functions later, but never participates in producing it.
