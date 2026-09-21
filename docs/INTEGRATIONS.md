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

## 2. MS Project integration — shipped (Phase 6)

### 2.1 Discovery findings (confirmed against a real file)

A half-day discovery spike against a real studio export (`NEW-OVR-MACRO-RELEASE-27.mpp`, 769
non-summary tasks) settled every mapping question empirically — no field mapping below is a guess:

- **Discipline** = task custom field **Text1** (observed codes: `ANIM, LIGHT, VFX, MOCAP, PREPROD,
  ASSET, SCRIPT, SHOOT, MARKET`).
- **LOQ type** = **Text2** (e.g. `L0, L1, L2, L3`).
- **Jira key** = **Text3** (pattern `OVR-\d+`); 78% of leaf tasks carry one — untagged leaf tasks are
  skipped (structural/organizational rows, not LOQs).
- **Cinematic** = the leaf task's immediate parent task name (outline level 3) — untagged itself,
  used purely as a grouping label.
- **Dependencies are real and load-bearing**: explicit finish-to-start predecessor edges within a
  discipline (e.g. `Anim-L0 → L1 → L2 → L3`) *and* across disciplines (`Light-L1` needs both
  `Light-L0` and `Anim-L0`; `VFX-L0` needs `Anim-L0`). Imported verbatim, never synthesized; an edge
  is only kept when both endpoints resolved to an imported, jira-tagged task.
- **Effort**: `Work` (hours) is populated for Anim/Light/VFX (~8h/day) but often `0` elsewhere →
  falls back to `Duration` in days when `Work` is zero.
- **Resource assignments** to real named people come from `project.getResourceAssignments()` (a
  task's own `getResource()` is unreliable — returns null in practice). Units are mostly 100% with
  real variation; assignment dates occasionally differ from task dates and are kept as given.
- Calendars are plain 5-day weeks with a few holiday exceptions per resource — the flat capacity
  model (brief §10) is a reasonable v1; per-resource calendar exceptions are explicitly out of scope.
- Resource-level custom fields (role/job-title) were empty in the validated file — new people are
  created with a discipline-hinted generic pool (see §2.4), not a job title, since there is nothing
  more granular to feed from either the file or the domain model.

### 2.2 Architecture: bundled MPXJ shim, not a JS parser

`.mpp` is a binary OLE2 format with no mature pure-JS parser. Decision: use the official, mature
**MPXJ** Java library (`net.sf.mpxj:mpxj:16.7.0`, LGPL, Maven Central) rather than an unvetted native
npm package, and bundle a minimal JRE + the jars into the Electron installer so the studio never
needs its own Java install:

```text
.mpp file
  │  (Electron main process, bundled JRE)
  ▼  java -cp lib/*;shim  MppToJson  <path>   →  JSON on stdout
JSON  ──parseMppJson()──►  NormalizedMppImport   (pure, fixture-tested)
                              │  + interactive discipline resolution (UI)
                              ▼
                        applyMppImport(db, normalized, targetProjectId, disciplineMap)
                              ▼  one Project's Cinematics / LOQs / dependencies / resources
```

- `java/MppToJson.java` reads the file via `UniversalProjectReader` and emits one JSON object per
  jira-tagged leaf task, plus a resource roster, to stdout.
- `resources/mpp/lib/*.jar` (vendored, committed) are mpxj + its transitive runtime deps, resolved
  via a committed `java/pom.xml`. `scripts/prepare-mpp-runtime.mjs` compiles the shim and `jlink`s a
  minimal JRE at build time (gitignored build output; needs a JDK on the build machine — CI always
  has one via `actions/setup-java`).
- `electron/main.cjs` spawns the bundled `java` binary from the renderer's file-picker request
  (`electron/preload.cjs` exposes `window.mpp.pickAndParse()`); stdout is parsed as JSON, stderr is
  surfaced verbatim on a non-zero exit.
- `src/import/mppImport.ts`'s `parseMppJson()` is a pure function from that JSON to
  `NormalizedMppImport` — no I/O, fixture-tested in `tests/mppImport.test.ts`.

### 2.3 Project scoping — the non-negotiable constraint

**A single `.mpp` import always targets exactly one existing Project, and writes only within that
Project's own data.** This matters because LOQs are matched globally by `jiraKey` (`DATA_MODEL.md`
— `jira_key` is globally unique), so a naive "match by key, write the match" reconciler could
silently rewrite another project's LOQ on a key collision. `src/db/applyMppImport.ts` closes that
gap structurally, not by convention:

- **Cinematics** are matched/created only among rows where `projectId === targetProjectId` — a
  same-named cinematic in another project is never reused.
- **LOQs** are matched by `jiraKey` against the *entire* database. If the match's cinematic belongs
  to a project other than `targetProjectId`, the import **skips it and records a warning** — it is
  never rewritten, reassigned, or merged. This is the one case where "matched but skipped" beats
  "matched and applied."
- **People** and **disciplines** are shared/global by design (same as every other importer) and are
  matched or created without project scoping — only their assignment *into* this project's LOQs is
  scoped.
- `tests/applyMppImport.test.ts` asserts this with a byte-identical before/after snapshot of a second
  project's cinematics/LOQs when a jiraKey collision is deliberately seeded.

### 2.4 UX decisions (given directly by the product owner)

1. **Discipline mapping is interactive, not silent.** Each Text1 code is auto-matched to an existing
   discipline by normalized name (`suggestDisciplineMatches`). If every code auto-matches, the import
   applies immediately with no extra step. Otherwise the import UI (`MppImportDrawer.tsx`) shows one
   row per code — including already-matched ones, so a match can still be overridden — with a
   dropdown of existing disciplines plus a "Create new discipline…" option pre-filled with the code
   as the name (editable) and a suggested contrasting color, before the user confirms.
2. **Unmatched resource people are created, and fuzzy-merged into existing ones.** New people get a
   discipline-hinted generic pool (via `resolveGenericPoolId`/`genericPoolName`) when a discipline is
   available; there was nothing more granular to feed (§2.1). Matching against existing people uses
   `personMatchKey()` (`src/domain/identity.ts`): NFD-normalize → strip diacritics → lowercase → sort
   whitespace-split tokens → join — so `"Éric Dupont"`, `"eric dupont"`, and `"Dupont Eric"` all
   resolve to the same person. Deliberately a separate function from `normalizeKey()` (used by the
   RPM/Staffing importers), which needs an exact, stable key rather than a fuzzy one.

### 2.5 Import mapping (confirmed)

| MS Project field | Target field | Notes |
|---|---|---|
| Text1 | Discipline (mapped via `disciplineMap`, §2.4) | |
| Text2 | `LOQ.type` | |
| Text3 | `LOQ.jira_key` | Matched globally; see §2.3 for the cross-project collision rule. |
| Parent task name | `Cinematic.name` | Matched/created only within `targetProjectId` (§2.3). |
| Start / Finish | `loq_commitment_events.committed_start/finish` | New LOQ: creates the initial event. Re-import: appends a new event only if the dates actually changed — same append-only rule as any other commitment change (`DATA_MODEL.md` §2). |
| Work (hours), falling back to Duration (days) | `LOQ.estimate_days` | `estimateDays = Work>0 ? round1(Work/8) : Duration`. |
| Predecessors | `loq_dependencies` (`source='override'`) | Kept only when both endpoints resolved to LOQs in `targetProjectId`; guarded by `wouldCreateCycle` (skip + warn on a cycle). Upserts on `(predecessor, successor)`, so re-import doesn't duplicate. |
| Resource assignments (name, dates, units) | `loq_resources` | Person resolved via `personMatchKey()` fuzzy match (§2.4) or created; `fte = units/100`. |

Re-importing the same file is idempotent: cinematics/LOQs/dependencies are matched by key before
being created, and a commitment event is only appended when dates genuinely changed.

### 2.6 Export (Planner → MS Project)

Still deferred past the first vertical slice (brief explicitly frames this as "eventually," not
initial — §1, §14). When built, it should reuse the same adapter boundary in reverse: domain →
normalized DTO → MPP/XML writer, so the writer is swappable independently of the domain model,
symmetric with import.

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

Both integrations carried the same risk shape: **the biggest risk is not engineering, it's that the
target system's real structure is unknown.** Recommended order, followed in practice:

1. Get one real MS Project export and (ideally) read access to one real Jira project *before*
   writing any adapter code — a half-day discovery spike each, not a multi-week research phase.
   **Done for MS Project** (§2.1); still open for Jira.
2. Build the LOQ/Cinematic/Dependency domain model and the deterministic forecast engine first,
   independent of both integrations, validated with hand-built fixtures (exactly like the existing
   `tests/fixtures.ts` pattern) standing in for "what Jira/MPP would eventually provide." **Done**
   (Phases 1-4).
3. Only then build the adapters, once real sample data exists to validate the mapping tables above
   against actual field values instead of assumptions. **Done for MS Project** (§2, Phase 6,
   shipped); still open for Jira (Phase 5).

This ordering is reflected in `IMPLEMENTATION_PLAN.md`'s phasing.
