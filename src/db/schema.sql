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
  team         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pool_capacity_overrides (
  pool_id      TEXT NOT NULL REFERENCES resource_pools(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,
  capacity_fte REAL NOT NULL,
  PRIMARY KEY (pool_id, period)
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

-- Persistent, name-keyed overrides layer for the Structure view. Never overwritten by import —
-- the RPM importer merges disciplines/pools/people by name, so an override keyed by the same
-- normalized name re-applies automatically after a re-import.
CREATE TABLE IF NOT EXISTS structure_overrides (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL, -- 'person_pool' | 'pool_discipline' | 'pool_person_pool' | '{discipline,pool,person,project}_name'
  source_key TEXT NOT NULL,
  target_key TEXT NOT NULL,
  UNIQUE (kind, source_key)
);

CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_requirements_pool ON requirements(pool_id);
CREATE INDEX IF NOT EXISTS idx_req_alloc_req ON requirement_allocations(requirement_id);
CREATE INDEX IF NOT EXISTS idx_people_pool ON people(pool_id);
CREATE INDEX IF NOT EXISTS idx_pasn_project ON person_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_pasn_person ON person_assignments(person_id);
CREATE INDEX IF NOT EXISTS idx_pasn_alloc ON person_assignment_allocations(person_assignment_id);
