# Integrations — MS Project & Jira (Proposal)

Both integrations are **zero-existing-code today** (`ARCHITECTURE_AUDIT.md` §5) — this document
proposes an architecture, not a validated design, and is explicit throughout about what needs to be
confirmed against real systems before implementation starts.

## 1. Shared architectural principle: adapter, not domain leakage

The two existing Excel importers already establish the right shape and should be the template for
both new integrations, generalized:

```text
External source  →  parse()  →  Normalized DTO  →  reconcile/apply()  →  domain tables
                     (format-specific,               (format-agnostic,
                      brittle, isolated)               diff-aware, shared)
```

Concretely: `src/import/rpmImport.ts` and `src/import/staffingImport.ts` both produce the same
`NormalizedImport` shape, consumed by one shared `applyImport()`. Do the same for MS Project and
Jira — a `parseMppExport()`/`fetchJiraIssues()` each produce a normalized DTO
(`NormalizedLoqBatch`), and one shared `applyLoqSync()` reconciles it against `loqs` +
`jira_sync_state`. This keeps the internal domain model (`LOQ`, `Cinematic`, `Dependency`)
completely ignorant of MPP or Jira-specific vocabulary, which is exactly what the brief asks for
(§14: "the import/export model should be designed as an adapter rather than making the internal
domain model dependent on MPP semantics").

## 2. MS Project integration

### 2.1 What must be confirmed before designing further

The brief assumes existing MS Project import/export requirements can be inspected from the
codebase — **there are none to inspect** (`ARCHITECTURE_AUDIT.md` §5, confirmed by exhaustive grep).
Before finalizing field mappings, someone needs to hand over **one real exported file** from the
studio's actual MS Project usage (either `.mpp` or MS Project's XML interchange format) so the
following can be answered directly instead of guessed:

> **Update (2026-09-18, product-owner decision)**: a real sample is now available —
> `NEW-OVR-MACRO-RELEASE-27.mpp`, provided by the product owner on their local machine. This
> answers the "no real file exists" gap; the discovery-spike prerequisite for Phase 6 can start by
> inspecting this file's actual field usage (`.mpp` is a binary/proprietary format — needs a parser
> library, e.g. `mpxj`, to read; not something to hand-parse). Jira: the product owner confirmed
> they can generate a real API token when a discovery spike for Phase 5 is scheduled — no token has
> been generated or used yet.

- Does the studio's usage populate `Duration` and `Work` as genuinely distinct fields, or are they
  always proportional (i.e. effectively just one number today)?
- Are dependencies (`Predecessors`) actually used in the source files, or is the plan currently
  flat/date-only in practice?
- Is there an existing naming convention in MS Project task names that already encodes
  Cinematic/Discipline/LOQ-type (the way the RPM importer relies on exact French column headers) —
  if so, the importer can key off that instead of requiring a manual mapping step.
- Does the studio use MS Project's resource-calendar features (holidays, part-time resources) in a
  way that would produce dates the flat 5-day-week capacity model (brief §10) can't reproduce? If
  so, that's a modeling gap to flag back to the product owner, not something to silently
  approximate.

### 2.2 Proposed import mapping (provisional, pending §2.1)

| MS Project field | Target field | Notes |
|---|---|---|
| Task name | `LOQ.type` + free-text hint for `Cinematic`/`Discipline` matching | Needs the studio's real naming convention (§2.1) to do this reliably; falls back to a manual mapping step in the import UI otherwise. |
| Start / Finish | `loq_commitment_events.committed_start/finish` (first row) | Import always creates the *initial* commitment event, never writes into `loqs.committed_*` directly — same append-only rule as any other commitment change (`DATA_MODEL.md` §2). |
| Duration | Not directly mapped — day-level start/finish is what matters to this product; Duration is MS-Project-internal derived data | Confirm with a real file whether Duration ever disagrees with Finish−Start in a way that matters. |
| Work | `LOQ.estimate_days` | Only if §2.1 confirms Work is populated meaningfully. |
| Predecessors | `loq_dependencies` (materialized, `source='override'` since these come from a specific plan, not a discipline template) | Requires resolving MS Project's own task IDs to `loq_id`s, which only works if tasks map cleanly to LOQs — see §2.1. |
| Resource assignments | `loq_resources` | Requires resource names to match existing `people.name` (reuse `normalizeKey()` matching, same as the existing importers). |

### 2.3 Export (Planner → MS Project)

Deferred past the first vertical slice (brief explicitly frames this as "eventually," not initial —
§1, §14). When built, it should reuse the same adapter boundary in reverse: domain → normalized DTO
→ MPP/XML writer, so the writer is swappable independently of the domain model, symmetric with
import.

## 3. Jira integration

### 3.1 What must be confirmed before designing further

Brief §13 itself warns "do not assume rich Jira metadata exists... may rely heavily on naming,
hierarchy, assignees." This needs a **discovery spike against a real Jira project** before the
`jira_sync_state` mapping can be trusted:

- What issue type represents a LOQ in practice — a dedicated type, or a labeled/named convention on
  a generic task type?
- Is there a reliable field (custom field, label, epic link) that already encodes
  Cinematic/Discipline, or does matching have to happen by name/parsing like the existing Excel
  importers do?
- What statuses does the real workflow use, and how do they map onto the three-value TODO/IN
  PROGRESS/DONE model (brief §4)? Real Jira workflows often have more granular statuses (e.g. "In
  Review", "Blocked") — these need an explicit mapping table, not a guess, and any status this
  mapping can't confidently place should surface as a `jira_inconsistency` warning rather than being
  silently forced into one of the three buckets.
- Read access mechanism available now: REST API with an API token, a webhook, or only manual
  CSV/export? This determines whether sync can be near-real-time or has to start as a periodic pull
  (or even a manual "import Jira export" step, following the existing Excel-import pattern, as a
  bridge until real API access is arranged).

### 3.2 Proposed sync shape (provisional, pending §3.1)

- **Read-only from the Planner's perspective in V1.** The Planner never writes back to Jira (brief
  §13 frames Jira purely as the execution/status source; nothing in the brief asks for write-back,
  and it would be a large trust/authority question to open unprompted).
  - Polling pull (interval TBD by whatever access mechanism §3.1 confirms) rather than webhooks for
    V1 — simpler, and this app has no server to receive a webhook against yet (see
    `COLLABORATION_MODEL.md`).
  - Each pull updates `jira_sync_state` for matched LOQs (by `jira_key`) and recomputes the
    `jira_inconsistency` sanity checks (§3.3) — it never writes into `loqs.status` directly; `LOQ`
    status stays a value the planning side owns, compared against (not overwritten by) Jira's
    status.

  This is a specific, deliberate design choice worth confirming with the product owner: brief §4
  describes LOQ status as if it's one shared value, but §13's own examples ("Planning says TODO,
  Jira says DONE → inconsistency") only make sense if planning-status and Jira-status are two
  separate values being *compared*, not one value Jira silently overwrites. Recommend keeping them
  separate (`loqs.status` = planning's own tracked status, `jira_sync_state.jira_status` = latest
  raw pull) and surfacing disagreement as an explicit, visible inconsistency rather than one
  silently winning — this is the same "never silently adapt to reality" principle the whole
  committed-plan model is built on (brief §5), applied to status instead of dates.

### 3.3 Inconsistency detection (feeds `PLANNING_ENGINE.md` §8's `jira_inconsistency` check)

Directly from brief §13's own examples:

| Planning status | Jira status | Signal |
|---|---|---|
| TODO | DONE | critical — work happened without planning knowing; forecast/actual should likely adopt Jira's completion date pending human confirmation |
| IN PROGRESS | TODO | warning — potential inconsistency, could be a planning lag or a Jira regression |
| anything not DONE | DONE, before committed date | info — early completion opportunity (`PLANNING_ENGINE.md` §4.2) |
| anything not DONE | still open/in-progress, past committed date | warning/critical scaled by how far past — this is the ordinary "late" case, already covered by `loq_at_risk` |

### 3.4 Where actuals come from

`LOQ.actual_finish` (`DATA_MODEL.md` §2) is written **only** by the Jira sync adapter reading a
completion date/status transition from Jira, or by an explicit manual "mark done" action when no
`jira_key` is linked yet. This is the brief's own model (§5: "Actual... usually derived from Jira
completion state/date") — the Planner does not independently decide when something is "actually"
done.

## 4. Sequencing recommendation

Both integrations carry the same risk shape: **the biggest risk is not engineering, it's that the
target system's real structure is unknown.** Recommend, in this order:

1. Get one real MS Project export and (ideally) read access to one real Jira project *before*
   writing any adapter code — a half-day discovery spike each, not a multi-week research phase.
2. Build the LOQ/Cinematic/Dependency domain model and the deterministic forecast engine first,
   independent of both integrations, validated with hand-built fixtures (exactly like the existing
   `tests/fixtures.ts` pattern) standing in for "what Jira/MPP would eventually provide."
3. Only then build the adapters, once real sample data exists to validate the mapping tables above
   against actual field values instead of assumptions.

This ordering is reflected in `IMPLEMENTATION_PLAN.md`'s phasing.
