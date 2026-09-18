# Data Model — Proposed Entities (Proposal, Not Implemented)

This proposes the additive schema for the new domain concepts, following the exact conventions the
current `src/db/schema.sql` already uses (TEXT primary keys via `newId()`, `CREATE TABLE IF NOT
EXISTS`, explicit indexes, comments explaining *why* a shape was chosen). Everything here is
**additive** — no existing table changes shape. Migration would be a new `migrateV6toV7()` step
following the pattern already established in `src/db/database.ts`.

## 1. Design principles carried over from the existing schema

- **Name-keyed overlays over ID-keyed mutation**, where survival across re-import/re-sync matters
  (proven pattern: `structure_overrides`).
- **Append-only where history matters**, plain upsert where it doesn't (new — the current schema has
  no append-only tables at all, because nothing needed history before).
- **Derive, don't store**, whenever a value is a pure function of other stored state (proven
  pattern: `deriveProjectStatus()`; proven anti-pattern to avoid: `Project.status` drifting from it).
- **Monthly rollup stays monthly; day-level stays day-level.** Do not force LOQ dates into
  `Period` strings.

## 2. New tables

### `cinematics`

```sql
CREATE TABLE cinematics (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  target_date  TEXT,              -- ISO yyyy-mm-dd, nullable (TBD)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  notes        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_cinematics_project ON cinematics(project_id);
```

One Cinematic = normally one sequence, occasionally several (brief §3) — this is a single flat
field, not a shot list; V1 explicitly does not decompose further (brief §3's non-goal).

### `loqs`

```sql
CREATE TABLE loqs (
  id                TEXT PRIMARY KEY,
  cinematic_id      TEXT NOT NULL REFERENCES cinematics(id) ON DELETE CASCADE,
  discipline_id     TEXT NOT NULL REFERENCES disciplines(id) ON DELETE RESTRICT,
  jira_key          TEXT,               -- e.g. "PROD-1234"; nullable until synced/linked
  type              TEXT NOT NULL,      -- e.g. "L1", "L2", "Final" — free text initially,
                                          -- validate against real Jira issue types before
                                          -- constraining to an enum (see INTEGRATIONS.md)
  status            TEXT NOT NULL DEFAULT 'TODO',  -- 'TODO' | 'IN_PROGRESS' | 'DONE'
  estimate_days     REAL,               -- planned effort; nullable
  committed_start   TEXT,               -- ISO date, nullable (TBD) — derived from the newest
  committed_finish  TEXT,               -- committed_events row, but cached here for read speed
                                          -- (see §3 on why this is a cache, not the source of truth)
  actual_finish     TEXT,               -- ISO date, set only by Jira sync or explicit manual close
  dod_ref           TEXT NOT NULL DEFAULT '',  -- Definition of Done, free text or external ref
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_loqs_cinematic ON loqs(cinematic_id);
CREATE INDEX idx_loqs_discipline ON loqs(discipline_id);
CREATE UNIQUE INDEX idx_loqs_jira_key ON loqs(jira_key) WHERE jira_key IS NOT NULL;
```

`committed_start`/`committed_finish` are stored as a **denormalized cache** of "the newest row in
`loq_commitment_events` for this LOQ" — same trade-off the existing `structure_overrides` resolver
makes (resolve once centrally, cache the effective value, never let the UI compute it ad hoc). The
`loq_commitment_events` table (§below) remains the actual source of truth; the cache is rebuilt the
same way `reload()` already rebuilds `PlanningEngine` from raw tables today.

**Deliberately absent**: a `forecast_date` column. Forecast is computed (see `PLANNING_ENGINE.md`
§2) and must never be persisted as an independently-editable field, to avoid recreating the
`Project.status` drift bug.

### `loq_commitment_events`

```sql
CREATE TABLE loq_commitment_events (
  id                TEXT PRIMARY KEY,
  loq_id            TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  committed_start   TEXT,
  committed_finish  TEXT,
  changed_by        TEXT NOT NULL,
  changed_at        TEXT NOT NULL,     -- ISO datetime
  reason            TEXT NOT NULL DEFAULT '',
  comment           TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_commit_events_loq ON loq_commitment_events(loq_id, changed_at);
```

Append-only. The first row for a LOQ is its initial commitment (from MS Project import or manual
entry); every subsequent row is an explicit re-commitment. `loqs.committed_start/finish` is always
the values from the row with the max `changed_at` for that `loq_id`.

### `loq_resources`

```sql
CREATE TABLE loq_resources (
  id           TEXT PRIMARY KEY,
  loq_id       TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  start_date   TEXT,                        -- ISO date; null = not yet scheduled
  finish_date  TEXT,                         -- ISO date; null = not yet scheduled
  fte          REAL NOT NULL DEFAULT 1.0    -- share of this person's time during this window
);
CREATE INDEX idx_loq_resources_person ON loq_resources(person_id);
```

Each row is one assignment **window**, not one row per `(loq_id, person_id)` — there is no longer a
uniqueness constraint on that pair, since a person may have several disjoint windows on the same
LOQ (e.g. worked it in May, someone else covered a gap, they came back in November). `start_date`/
`finish_date` are nullable: a row with no window is "not yet scheduled" and contributes 0 to every
month, never a fallback spread over the LOQ's `committed_start`/`committed_finish`.

Supports brief §11 ("multiple resources may contribute to the same Cinematic and/or LOQ... may work
in parallel... sequential work where necessary" — sequencing between two people on the same LOQ is
just two rows with disjoint windows, nothing more structural is needed for V1). This table is the
**assigned** side of the bottom-up rollup described in `PLANNING_ENGINE.md` §1: summing
`loq_resources` by the LOQ's discipline and month, strictly over each row's own `start_date`/
`finish_date` — a LOQ with no resource rows contributes zero, never the committed window or
`estimate_days` as a fallback. The separate **demand** side of that same rollup reads the LOQ's own
`committed_start`/`committed_finish`/`estimate_days` instead, and exists independently of whether
any `loq_resources` row exists yet.

### `loq_dependencies`

```sql
CREATE TABLE loq_dependencies (
  id                  TEXT PRIMARY KEY,
  predecessor_loq_id  TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  successor_loq_id    TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  type                TEXT NOT NULL DEFAULT 'finish_to_start',
  lag_days            INTEGER NOT NULL DEFAULT 0,
  source              TEXT NOT NULL DEFAULT 'override',  -- 'template' | 'override'
  template_id         TEXT REFERENCES dependency_templates(id) ON DELETE SET NULL,
  UNIQUE (predecessor_loq_id, successor_loq_id)
);
CREATE INDEX idx_loq_dep_predecessor ON loq_dependencies(predecessor_loq_id);
CREATE INDEX idx_loq_dep_successor ON loq_dependencies(successor_loq_id);
```

Cycle rejection is application-level (see `PLANNING_ENGINE.md` §6), not a DB constraint — sql.js has
no recursive CHECK support worth relying on, and the existing codebase's convention is to validate
in the repository/store layer (see `repository.ts`'s hand-written cascade logic) rather than lean on
SQL features sql.js doesn't reliably enforce (it doesn't even enforce plain FKs — see
`ARCHITECTURE_AUDIT.md` §4).

### `dependency_templates`

```sql
CREATE TABLE dependency_templates (
  id                       TEXT PRIMARY KEY,
  predecessor_discipline_id TEXT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
  predecessor_loq_type      TEXT NOT NULL,
  successor_discipline_id   TEXT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
  successor_loq_type        TEXT NOT NULL,
  type                      TEXT NOT NULL DEFAULT 'finish_to_start',
  lag_days                  INTEGER NOT NULL DEFAULT 0
);
```

### `variance_events`

```sql
CREATE TABLE variance_events (
  id                          TEXT PRIMARY KEY,
  loq_id                      TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  category                    TEXT NOT NULL,   -- see PLANNING_ENGINE.md §4.1
  comment                     TEXT NOT NULL DEFAULT '',
  declared_by                 TEXT NOT NULL,
  declared_at                 TEXT NOT NULL,
  committed_date_at_declaration TEXT,
  forecast_date_at_declaration  TEXT,
  delta_days                  INTEGER NOT NULL
);
CREATE INDEX idx_variance_loq ON variance_events(loq_id, declared_at);
```

Append-only, never edited or deleted (a correction is a new row, not an in-place fix — same
rationale as `loq_commitment_events`). This is the table the "how many days did we lose, why, how
often, downstream impact" analytics (brief §6) is built from directly — no separate reporting schema
needed for V1, these two event tables (`loq_commitment_events`, `variance_events`) are sufficient
raw material.

### `jira_sync_state` (see `INTEGRATIONS.md` for the adapter design this supports)

```sql
CREATE TABLE jira_sync_state (
  loq_id           TEXT PRIMARY KEY REFERENCES loqs(id) ON DELETE CASCADE,
  jira_status      TEXT,            -- raw Jira status string, unmapped
  jira_assignee    TEXT,
  jira_updated_at  TEXT,            -- Jira's own last-updated timestamp
  last_synced_at   TEXT NOT NULL,
  raw_snapshot     TEXT NOT NULL DEFAULT '{}'  -- JSON blob of whatever fields the adapter cared about
);
```

Kept deliberately separate from `loqs` itself (rather than adding Jira columns directly to `loqs`)
so the Jira adapter can be swapped/versioned independently, mirroring how the two existing Excel
importers already keep "what the source file said" (`ImportReport`) separate from "what we did with
it" (the applied domain rows).

## 3. Entity relationship summary

```text
Project 1───N Cinematic 1───N LOQ 1───N loq_resources ───N Person (existing)
                                │
                                ├──1───N loq_commitment_events   (history of committed dates)
                                ├──1───N variance_events          (history of declared variance)
                                ├──1───1 jira_sync_state          (latest known Jira snapshot)
                                └──N───N loq_dependencies ─────── LOQ (predecessor/successor, self-referential)

dependency_templates  (discipline × LOQ-type pairing, materialized into loq_dependencies on creation)
```

Everything under `Cinematic` is new. Everything above `Cinematic` (`Project`, `Discipline`,
`Person`, `ResourcePool`) is the existing schema, untouched.

## 4. What is deliberately not modeled

- **No `Task`/shot entity below LOQ.** Matches brief §3's explicit non-goal.
- **No generic percentage-complete field on LOQ.** Status is the three-value enum only.
- **No stored `forecast_date`** — see §2 `loqs` table note and `PLANNING_ENGINE.md` §2.
- **No full-plan snapshot table.** History is reconstructed from the two append-only event tables
  (§2), not from periodic whole-plan snapshots — cheaper to write, and sufficient for the "why was
  this different last week" question (brief §16) at LOQ granularity, which is the granularity that
  actually changes.
- **No row-version/optimistic-concurrency column added here** — that belongs to the collaboration
  layer, not the domain schema, and is deferred to `COLLABORATION_MODEL.md` since it only matters
  once a shared backend exists; adding it to every table prematurely would be unused complexity in a
  single-user file, per the brief's own "avoid premature abstraction" instruction.
