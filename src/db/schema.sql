-- Cinematic Resource Planner — SQLite schema
-- Every requirement/assignment carries a scenario_id so future what-if scenarios are additive
-- (new scenario rows + a filter) rather than a breaking schema change.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  is_base INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS disciplines (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resource_pools (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  capacity_fte  REAL NOT NULL DEFAULT 0,
  color         TEXT NOT NULL DEFAULT '#6b7280',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  discipline_id TEXT REFERENCES disciplines(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS people (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  pool_id      TEXT REFERENCES resource_pools(id) ON DELETE SET NULL,
  capacity_fte REAL NOT NULL DEFAULT 1.0,
  active       INTEGER NOT NULL DEFAULT 1,
  notes        TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  team         TEXT NOT NULL DEFAULT '',
  site         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'planned',
  start_date      TEXT,
  start_certainty TEXT NOT NULL DEFAULT 'estimated',
  end_date        TEXT,
  end_certainty   TEXT NOT NULL DEFAULT 'estimated',
  priority        TEXT NOT NULL DEFAULT 'medium',
  notes           TEXT NOT NULL DEFAULT '',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_dispo        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS requirements (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pool_id     TEXT NOT NULL REFERENCES resource_pools(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  UNIQUE (project_id, pool_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS requirement_allocations (
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  period         TEXT NOT NULL,
  fte            REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (requirement_id, period)
);

CREATE TABLE IF NOT EXISTS person_assignments (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  UNIQUE (person_id, project_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS person_assignment_allocations (
  person_assignment_id TEXT NOT NULL REFERENCES person_assignments(id) ON DELETE CASCADE,
  period                TEXT NOT NULL,
  fte                   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (person_assignment_id, period)
);

-- Persistent, name-keyed overrides layer for Team's Structure & remapping section. Never overwritten by import —
-- the RPM importer merges disciplines/pools/people by name, so an override keyed by the same
-- normalized name re-applies automatically after a re-import.
CREATE TABLE IF NOT EXISTS structure_overrides (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL, -- 'person_pool' | 'pool_discipline' | 'pool_person_pool' | 'person_discipline' | '{discipline,pool,person,project}_name'
  source_key TEXT NOT NULL,
  target_key TEXT NOT NULL,
  UNIQUE (kind, source_key)
);

-- Cinematic/LOQ model (v7, additive — see docs/DATA_MODEL.md). Project 1─N Cinematic 1─N LOQ;
-- each LOQ carries its own resources/commitment history/variance history/Jira snapshot, plus
-- self-referential dependencies materialized from dependency_templates.

CREATE TABLE IF NOT EXISTS cinematics (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  target_date  TEXT,              -- ISO yyyy-mm-dd, nullable (TBD)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  notes        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS loqs (
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
  committed_finish  TEXT,               -- loq_commitment_events row, cached here for read speed
  actual_finish     TEXT,               -- ISO date, set only by Jira sync or explicit manual close
  dod_ref           TEXT NOT NULL DEFAULT '',  -- Definition of Done, free text or external ref
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dependency_templates (
  id                        TEXT PRIMARY KEY,
  predecessor_discipline_id TEXT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
  predecessor_loq_type      TEXT NOT NULL,
  successor_discipline_id   TEXT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
  successor_loq_type        TEXT NOT NULL,
  type                      TEXT NOT NULL DEFAULT 'finish_to_start',
  lag_days                  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS loq_commitment_events (
  id                TEXT PRIMARY KEY,
  loq_id            TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  committed_start   TEXT,
  committed_finish  TEXT,
  changed_by        TEXT NOT NULL,
  changed_at        TEXT NOT NULL,     -- ISO datetime
  reason            TEXT NOT NULL DEFAULT '',
  comment           TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS loq_resources (
  id           TEXT PRIMARY KEY,
  loq_id       TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  fte          REAL NOT NULL DEFAULT 1.0,   -- share of this person's time on this LOQ
  UNIQUE (loq_id, person_id)
);

CREATE TABLE IF NOT EXISTS loq_dependencies (
  id                  TEXT PRIMARY KEY,
  predecessor_loq_id  TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  successor_loq_id    TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  type                TEXT NOT NULL DEFAULT 'finish_to_start',
  lag_days            INTEGER NOT NULL DEFAULT 0,
  source              TEXT NOT NULL DEFAULT 'override',  -- 'template' | 'override'
  template_id         TEXT REFERENCES dependency_templates(id) ON DELETE SET NULL,
  UNIQUE (predecessor_loq_id, successor_loq_id)
);

CREATE TABLE IF NOT EXISTS variance_events (
  id                            TEXT PRIMARY KEY,
  loq_id                        TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  category                      TEXT NOT NULL,   -- see PLANNING_ENGINE.md §4.1
  comment                       TEXT NOT NULL DEFAULT '',
  declared_by                   TEXT NOT NULL,
  declared_at                   TEXT NOT NULL,
  committed_date_at_declaration TEXT,
  forecast_date_at_declaration  TEXT,
  delta_days                    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jira_sync_state (
  loq_id           TEXT PRIMARY KEY REFERENCES loqs(id) ON DELETE CASCADE,
  jira_status      TEXT,            -- raw Jira status string, unmapped
  jira_assignee    TEXT,
  jira_updated_at  TEXT,            -- Jira's own last-updated timestamp
  last_synced_at   TEXT NOT NULL,
  raw_snapshot     TEXT NOT NULL DEFAULT '{}'  -- JSON blob of whatever fields the adapter cared about
);

CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_requirements_pool ON requirements(pool_id);
CREATE INDEX IF NOT EXISTS idx_req_alloc_req ON requirement_allocations(requirement_id);
CREATE INDEX IF NOT EXISTS idx_people_pool ON people(pool_id);
CREATE INDEX IF NOT EXISTS idx_pasn_project ON person_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_pasn_person ON person_assignments(person_id);
CREATE INDEX IF NOT EXISTS idx_pasn_alloc ON person_assignment_allocations(person_assignment_id);

CREATE INDEX IF NOT EXISTS idx_cinematics_project ON cinematics(project_id);
CREATE INDEX IF NOT EXISTS idx_loqs_cinematic ON loqs(cinematic_id);
CREATE INDEX IF NOT EXISTS idx_loqs_discipline ON loqs(discipline_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loqs_jira_key ON loqs(jira_key) WHERE jira_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commit_events_loq ON loq_commitment_events(loq_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_loq_resources_person ON loq_resources(person_id);
CREATE INDEX IF NOT EXISTS idx_loq_dep_predecessor ON loq_dependencies(predecessor_loq_id);
CREATE INDEX IF NOT EXISTS idx_loq_dep_successor ON loq_dependencies(successor_loq_id);
CREATE INDEX IF NOT EXISTS idx_variance_loq ON variance_events(loq_id, declared_at);
