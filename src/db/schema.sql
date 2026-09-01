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

CREATE TABLE IF NOT EXISTS resource_pools (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  capacity_fte REAL NOT NULL DEFAULT 0,
  color        TEXT NOT NULL DEFAULT '#6b7280',
  sort_order   INTEGER NOT NULL DEFAULT 0
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
  sort_order      INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS assignments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pool_id     TEXT NOT NULL REFERENCES resource_pools(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  UNIQUE (project_id, pool_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS assignment_allocations (
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,
  fte           REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (assignment_id, period)
);

CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_requirements_pool ON requirements(pool_id);
CREATE INDEX IF NOT EXISTS idx_assignments_project ON assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_assignments_pool ON assignments(pool_id);
CREATE INDEX IF NOT EXISTS idx_req_alloc_req ON requirement_allocations(requirement_id);
CREATE INDEX IF NOT EXISTS idx_asn_alloc_asn ON assignment_allocations(assignment_id);
