import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { PlannerDatabase, SCHEMA_VERSION } from '../src/db/database';
import { BASE_SCENARIO_ID, loadPlanningData } from '../src/db/repository';
import { PlanningEngine } from '../src/engine/planning';

const V1_SCHEMA = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE scenarios (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_base INTEGER NOT NULL DEFAULT 0);
CREATE TABLE resource_pools (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, capacity_fte REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#4f7cff', sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE pool_capacity_overrides (
  pool_id TEXT NOT NULL, period TEXT NOT NULL, capacity_fte REAL NOT NULL, PRIMARY KEY (pool_id, period)
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned',
  start_date TEXT, start_certainty TEXT NOT NULL DEFAULT 'estimated',
  end_date TEXT, end_certainty TEXT NOT NULL DEFAULT 'estimated',
  priority TEXT NOT NULL DEFAULT 'medium', notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE requirements (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pool_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
  UNIQUE (project_id, pool_id, scenario_id)
);
CREATE TABLE requirement_allocations (
  requirement_id TEXT NOT NULL, period TEXT NOT NULL, fte REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (requirement_id, period)
);
CREATE TABLE assignments (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pool_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
  UNIQUE (project_id, pool_id, scenario_id)
);
CREATE TABLE assignment_allocations (
  assignment_id TEXT NOT NULL, period TEXT NOT NULL, fte REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (assignment_id, period)
);
`;

/** Hand-builds a v1-shaped .sqlite byte blob: one pool, one project, one pool-level assignment. */
async function buildV1Bytes(): Promise<{ bytes: Uint8Array; poolId: string; projectId: string; assignmentId: string }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const stmt of V1_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    db.run(stmt);
  }

  const poolId = 'pool_v1_animation';
  const projectId = 'proj_v1_alpha';
  const assignmentId = 'asn_v1_1';

  db.run("INSERT INTO settings (key, value) VALUES ('schema_version', '1')");
  db.run("INSERT INTO scenarios (id, name, is_base) VALUES ('base', 'Current Plan', 1)");
  db.run(
    'INSERT INTO resource_pools (id, name, capacity_fte, color, sort_order) VALUES (?, ?, ?, ?, ?)',
    [poolId, 'Animation', 8, '#4f7cff', 0],
  );
  db.run(
    'INSERT INTO projects (id, name, status, start_date, start_certainty, end_date, end_certainty, priority, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [projectId, 'Cinematic Alpha', 'active', '2026-09-01', 'confirmed', '2026-12-31', 'confirmed', 'medium', '', 0],
  );
  db.run(
    'INSERT INTO assignments (id, project_id, pool_id, scenario_id) VALUES (?, ?, ?, ?)',
    [assignmentId, projectId, poolId, 'base'],
  );
  db.run('INSERT INTO assignment_allocations (assignment_id, period, fte) VALUES (?, ?, ?)', [assignmentId, '2026-09', 2]);
  db.run('INSERT INTO assignment_allocations (assignment_id, period, fte) VALUES (?, ?, ?)', [assignmentId, '2026-10', 3]);

  const bytes = db.export();
  db.close();
  return { bytes, poolId, projectId, assignmentId };
}

describe('v1 -> v2 migration', () => {
  it('opens a v1 database, drops legacy tables, and preserves capacity/assignment numbers via a synthesized person', async () => {
    const { bytes, poolId, projectId } = await buildV1Bytes();

    const db = await PlannerDatabase.openFromBytes(bytes);

    expect(db.getSetting('schema_version')).toBe(SCHEMA_VERSION);
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('assignments','assignment_allocations')")).toHaveLength(0);

    const poolColumns = db.query<{ name: string }>('PRAGMA table_info(resource_pools)');
    expect(poolColumns.some((c) => c.name === 'discipline_id')).toBe(true);

    const people = db.query<{ id: string; pool_id: string; capacity_fte: number }>('SELECT * FROM people');
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ id: `person_mig_${poolId}`, pool_id: poolId, capacity_fte: 8 });

    const data = loadPlanningData(db);
    const engine = new PlanningEngine(data, BASE_SCENARIO_ID);

    // Pre-migration numbers: capacity was the flat pool.capacityFte (8); assigned was 2 in Sept, 3 in Oct.
    expect(engine.getCapacity(poolId, '2026-09')).toBe(8);
    expect(engine.getAssignedCapacity(poolId, '2026-09')).toBe(2);
    expect(engine.getAssignedCapacity(poolId, '2026-10')).toBe(3);

    const staffing = engine.getProjectStaffing(projectId, '2026-09');
    expect(staffing.lines.find((l) => l.poolId === poolId)?.assigned).toBe(2);
  });

  it('leaves a fresh v2 database untouched (no legacy tables were ever created)', async () => {
    const db = await PlannerDatabase.createNew();
    expect(db.getSetting('schema_version')).toBe(SCHEMA_VERSION);
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='assignments'")).toHaveLength(0);
    expect(db.query('SELECT * FROM people')).toHaveLength(0);
  });

  it('is idempotent when re-opening an already-migrated v2 database', async () => {
    const { bytes, poolId } = await buildV1Bytes();
    const migrated = await PlannerDatabase.openFromBytes(bytes);
    const reopened = await PlannerDatabase.openFromBytes(migrated.export());

    expect(reopened.getSetting('schema_version')).toBe(SCHEMA_VERSION);
    const people = reopened.query('SELECT * FROM people');
    expect(people).toHaveLength(1);

    const data = loadPlanningData(reopened);
    const engine = new PlanningEngine(data, BASE_SCENARIO_ID);
    expect(engine.getCapacity(poolId, '2026-09')).toBe(8);
    expect(engine.getAssignedCapacity(poolId, '2026-09')).toBe(2);
  });
});

const V6_TABLES = [
  'settings', 'scenarios', 'disciplines', 'resource_pools', 'people', 'projects',
  'requirements', 'requirement_allocations', 'person_assignments', 'person_assignment_allocations',
  'structure_overrides',
];

const V6_SCHEMA = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE scenarios (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_base INTEGER NOT NULL DEFAULT 0);
CREATE TABLE disciplines (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6b7280', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE resource_pools (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, capacity_fte REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6b7280', sort_order INTEGER NOT NULL DEFAULT 0,
  discipline_id TEXT REFERENCES disciplines(id) ON DELETE SET NULL
);
CREATE TABLE people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, pool_id TEXT REFERENCES resource_pools(id) ON DELETE SET NULL,
  capacity_fte REAL NOT NULL DEFAULT 1.0, active INTEGER NOT NULL DEFAULT 1, notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0, team TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT ''
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned',
  start_date TEXT, start_certainty TEXT NOT NULL DEFAULT 'estimated',
  end_date TEXT, end_certainty TEXT NOT NULL DEFAULT 'estimated',
  priority TEXT NOT NULL DEFAULT 'medium', notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
  is_dispo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE requirements (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pool_id TEXT NOT NULL REFERENCES resource_pools(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  UNIQUE (project_id, pool_id, scenario_id)
);
CREATE TABLE requirement_allocations (
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE, period TEXT NOT NULL, fte REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (requirement_id, period)
);
CREATE TABLE person_assignments (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  UNIQUE (person_id, project_id, scenario_id)
);
CREATE TABLE person_assignment_allocations (
  person_assignment_id TEXT NOT NULL REFERENCES person_assignments(id) ON DELETE CASCADE, period TEXT NOT NULL, fte REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (person_assignment_id, period)
);
CREATE TABLE structure_overrides (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, source_key TEXT NOT NULL, target_key TEXT NOT NULL,
  UNIQUE (kind, source_key)
);
`;

/** Hand-builds a v6-shaped byte blob (pre-cinematics/LOQ): one discipline, one pool, one project,
 * one requirement with an allocation — deliberately omits all 8 new v7 tables. */
async function buildV6Bytes(): Promise<{ bytes: Uint8Array; disciplineId: string; poolId: string; projectId: string; requirementId: string }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const stmt of V6_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    db.run(stmt);
  }

  const disciplineId = 'disc_v6_animation';
  const poolId = 'pool_v6_animation';
  const projectId = 'proj_v6_alpha';
  const requirementId = 'req_v6_1';

  db.run("INSERT INTO settings (key, value) VALUES ('schema_version', '6')");
  db.run("INSERT INTO scenarios (id, name, is_base) VALUES ('base', 'Current Plan', 1)");
  db.run('INSERT INTO disciplines (id, name, color, sort_order) VALUES (?, ?, ?, ?)', [disciplineId, 'Animation', '#4f7cff', 0]);
  db.run(
    'INSERT INTO resource_pools (id, name, capacity_fte, color, sort_order, discipline_id) VALUES (?, ?, ?, ?, ?, ?)',
    [poolId, 'Animation', 8, '#4f7cff', 0, disciplineId],
  );
  db.run(
    'INSERT INTO projects (id, name, status, start_date, start_certainty, end_date, end_certainty, priority, notes, sort_order, is_dispo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [projectId, 'Cinematic Alpha', 'active', '2026-09-01', 'confirmed', '2026-12-31', 'confirmed', 'medium', '', 0, 0],
  );
  db.run('INSERT INTO requirements (id, project_id, pool_id, scenario_id) VALUES (?, ?, ?, ?)', [requirementId, projectId, poolId, 'base']);
  db.run('INSERT INTO requirement_allocations (requirement_id, period, fte) VALUES (?, ?, ?)', [requirementId, '2026-09', 4]);

  const bytes = db.export();
  db.close();
  return { bytes, disciplineId, poolId, projectId, requirementId };
}

const V7_TABLES = [
  'cinematics', 'loqs', 'loq_commitment_events', 'loq_resources', 'loq_dependencies',
  'dependency_templates', 'variance_events', 'jira_sync_state',
];

describe('v6 -> v7 migration', () => {
  it('a fresh database has all 8 new tables and schema_version 8', async () => {
    const db = await PlannerDatabase.createNew();
    expect(db.getSetting('schema_version')).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe('8');

    const tables = new Set(db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name));
    for (const t of V7_TABLES) expect(tables.has(t)).toBe(true);

    const loqColumns = db.query<{ name: string }>('PRAGMA table_info(loqs)').map((c) => c.name);
    expect(loqColumns).toEqual(expect.arrayContaining(['committed_start', 'committed_finish', 'jira_key', 'dod_ref', 'discipline_id']));

    const loqResourceColumns = db.query<{ name: string }>('PRAGMA table_info(loq_resources)').map((c) => c.name);
    expect(loqResourceColumns).toEqual(expect.arrayContaining(['start_date', 'finish_date', 'fte']));

    const jiraColumns = db.query<{ name: string; pk: number }>('PRAGMA table_info(jira_sync_state)');
    expect(jiraColumns.find((c) => c.name === 'loq_id')?.pk).toBe(1);

    const indexes = new Set(db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'").map((r) => r.name));
    expect(indexes.has('idx_loqs_jira_key')).toBe(true);
  });

  it('a legacy v6 database gains the 8 new tables (empty) and keeps its existing data', async () => {
    const { bytes, poolId, projectId } = await buildV6Bytes();

    const db = await PlannerDatabase.openFromBytes(bytes);
    expect(db.getSetting('schema_version')).toBe('8');

    for (const t of V7_TABLES) {
      expect(db.query(`SELECT COUNT(*) as c FROM ${t}`)[0]).toMatchObject({ c: 0 });
    }
    for (const t of V6_TABLES) {
      expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])).toHaveLength(1);
    }

    const data = loadPlanningData(db);
    const engine = new PlanningEngine(data, BASE_SCENARIO_ID);
    expect(engine.getCapacity(poolId, '2026-09')).toBe(8); // falls back to flat pool.capacityFte (no people seeded), unaffected by v7
    expect(engine.getRequiredCapacity(poolId, '2026-09')).toBe(4); // the pre-existing requirement/allocation survived untouched
    const staffing = engine.getProjectStaffing(projectId, '2026-09');
    expect(staffing.lines.find((l) => l.poolId === poolId)?.assigned).toBe(0);
    expect(data.projects.find((p) => p.id === projectId)?.name).toBe('Cinematic Alpha');
  });

  it('is idempotent when re-opening an already-migrated database', async () => {
    const { bytes } = await buildV6Bytes();
    const migrated = await PlannerDatabase.openFromBytes(bytes);
    const reopened = await PlannerDatabase.openFromBytes(migrated.export());

    expect(reopened.getSetting('schema_version')).toBe('8');
    for (const t of V7_TABLES) {
      expect(reopened.query(`SELECT COUNT(*) as c FROM ${t}`)[0]).toMatchObject({ c: 0 });
    }
  });

  it('healDanglingReferences drops a LOQ (and its children) once its discipline is gone', async () => {
    const db = await PlannerDatabase.createNew();
    db.exec("INSERT INTO disciplines (id, name, color, sort_order) VALUES ('disc1', 'Animation', '#4f7cff', 0)");
    db.exec("INSERT INTO projects (id, name) VALUES ('proj1', 'Alpha')");
    db.exec("INSERT INTO cinematics (id, project_id, name) VALUES ('cine1', 'proj1', 'Seq01')");
    db.exec("INSERT INTO loqs (id, cinematic_id, discipline_id, type) VALUES ('loq1', 'cine1', 'disc1', 'L1')");
    db.exec("INSERT INTO people (id, name) VALUES ('person1', 'Alice')");
    db.exec("INSERT INTO loq_resources (id, loq_id, person_id, fte) VALUES ('lres1', 'loq1', 'person1', 1)");
    db.exec("INSERT INTO loq_commitment_events (id, loq_id, changed_by, changed_at) VALUES ('lce1', 'loq1', 'Alice', '2026-09-01T00:00:00Z')");
    db.exec("INSERT INTO variance_events (id, loq_id, category, declared_by, declared_at, delta_days) VALUES ('ve1', 'loq1', 'scope', 'Alice', '2026-09-01T00:00:00Z', 1)");
    db.exec("INSERT INTO jira_sync_state (loq_id, last_synced_at) VALUES ('loq1', '2026-09-01T00:00:00Z')");
    db.exec("INSERT INTO loq_dependencies (id, predecessor_loq_id, successor_loq_id) VALUES ('ldep1', 'loq1', 'loq1')");

    db.exec("DELETE FROM disciplines WHERE id = 'disc1'"); // bypass the repository — direct dangling-ref scenario

    const reopened = await PlannerDatabase.openFromBytes(db.export());
    expect(reopened.query('SELECT * FROM loqs')).toHaveLength(0);
    expect(reopened.query('SELECT * FROM loq_resources')).toHaveLength(0);
    expect(reopened.query('SELECT * FROM loq_commitment_events')).toHaveLength(0);
    expect(reopened.query('SELECT * FROM variance_events')).toHaveLength(0);
    expect(reopened.query('SELECT * FROM jira_sync_state')).toHaveLength(0);
    expect(reopened.query('SELECT * FROM loq_dependencies')).toHaveLength(0);
    expect(reopened.query('SELECT * FROM cinematics')).toHaveLength(1); // the cinematic itself survives
  });

  it('healDanglingReferences sweeps cinematics/LOQs once their project is gone', async () => {
    const db = await PlannerDatabase.createNew();
    db.exec("INSERT INTO disciplines (id, name, color, sort_order) VALUES ('disc1', 'Animation', '#4f7cff', 0)");
    db.exec("INSERT INTO projects (id, name) VALUES ('proj1', 'Alpha')");
    db.exec("INSERT INTO cinematics (id, project_id, name) VALUES ('cine1', 'proj1', 'Seq01')");
    db.exec("INSERT INTO loqs (id, cinematic_id, discipline_id, type) VALUES ('loq1', 'cine1', 'disc1', 'L1')");

    db.exec("DELETE FROM projects WHERE id = 'proj1'"); // bypass deleteProject/deleteCinematic

    const reopened = await PlannerDatabase.openFromBytes(db.export());
    expect(reopened.query('SELECT * FROM cinematics')).toHaveLength(0);
    expect(reopened.query('SELECT * FROM loqs')).toHaveLength(0);
  });
});

const V7_SCHEMA = `
${V6_SCHEMA}
CREATE TABLE cinematics (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, target_date TEXT, sort_order INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE loqs (
  id TEXT PRIMARY KEY, cinematic_id TEXT NOT NULL REFERENCES cinematics(id) ON DELETE CASCADE,
  discipline_id TEXT NOT NULL REFERENCES disciplines(id) ON DELETE RESTRICT,
  jira_key TEXT, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'TODO', estimate_days REAL,
  committed_start TEXT, committed_finish TEXT, actual_finish TEXT, dod_ref TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE dependency_templates (
  id TEXT PRIMARY KEY, predecessor_discipline_id TEXT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
  predecessor_loq_type TEXT NOT NULL, successor_discipline_id TEXT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
  successor_loq_type TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'finish_to_start', lag_days INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE loq_commitment_events (
  id TEXT PRIMARY KEY, loq_id TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  committed_start TEXT, committed_finish TEXT, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT ''
);
-- Old (pre-v8) shape: dateless, one row per (loq, person).
CREATE TABLE loq_resources (
  id TEXT PRIMARY KEY, loq_id TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE, fte REAL NOT NULL DEFAULT 1.0,
  UNIQUE (loq_id, person_id)
);
CREATE TABLE loq_dependencies (
  id TEXT PRIMARY KEY, predecessor_loq_id TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE,
  successor_loq_id TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE, type TEXT NOT NULL DEFAULT 'finish_to_start',
  lag_days INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'override',
  template_id TEXT REFERENCES dependency_templates(id) ON DELETE SET NULL,
  UNIQUE (predecessor_loq_id, successor_loq_id)
);
CREATE TABLE variance_events (
  id TEXT PRIMARY KEY, loq_id TEXT NOT NULL REFERENCES loqs(id) ON DELETE CASCADE, category TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '', declared_by TEXT NOT NULL, declared_at TEXT NOT NULL,
  committed_date_at_declaration TEXT, forecast_date_at_declaration TEXT, delta_days INTEGER NOT NULL
);
CREATE TABLE jira_sync_state (
  loq_id TEXT PRIMARY KEY REFERENCES loqs(id) ON DELETE CASCADE, jira_status TEXT, jira_assignee TEXT,
  jira_updated_at TEXT, last_synced_at TEXT NOT NULL, raw_snapshot TEXT NOT NULL DEFAULT '{}'
);
`;

/** Hand-builds a v7-shaped byte blob: v6 base + the 8 v7 tables in their original shape, with one
 * loq_resources row in the OLD dateless/unique-pair shape — to prove the v7->v8 rebuild migration. */
async function buildV7Bytes(): Promise<{ bytes: Uint8Array; loqId: string; personId: string }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const stmt of V7_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    db.run(stmt);
  }

  const disciplineId = 'disc_v7_animation';
  const projectId = 'proj_v7_alpha';
  const cinematicId = 'cine_v7_1';
  const loqId = 'loq_v7_1';
  const personId = 'person_v7_1';

  db.run("INSERT INTO settings (key, value) VALUES ('schema_version', '7')");
  db.run("INSERT INTO scenarios (id, name, is_base) VALUES ('base', 'Current Plan', 1)");
  db.run('INSERT INTO disciplines (id, name, color, sort_order) VALUES (?, ?, ?, ?)', [disciplineId, 'Animation', '#4f7cff', 0]);
  db.run(
    'INSERT INTO projects (id, name, status, start_date, start_certainty, end_date, end_certainty, priority, notes, sort_order, is_dispo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [projectId, 'Cinematic Alpha', 'active', '2026-09-01', 'confirmed', '2026-12-31', 'confirmed', 'medium', '', 0, 0],
  );
  db.run('INSERT INTO cinematics (id, project_id, name) VALUES (?, ?, ?)', [cinematicId, projectId, 'Seq01']);
  db.run('INSERT INTO loqs (id, cinematic_id, discipline_id, type) VALUES (?, ?, ?, ?)', [loqId, cinematicId, disciplineId, 'L1']);
  db.run('INSERT INTO people (id, name) VALUES (?, ?)', [personId, 'Alice']);
  db.run('INSERT INTO loq_resources (id, loq_id, person_id, fte) VALUES (?, ?, ?, ?)', ['lres_v7_1', loqId, personId, 0.5]);

  const bytes = db.export();
  db.close();
  return { bytes, loqId, personId };
}

describe('v7 -> v8 migration', () => {
  it('rebuilds loq_resources with date columns and drops the (loq, person) uniqueness', async () => {
    const { bytes, loqId, personId } = await buildV7Bytes();

    const db = await PlannerDatabase.openFromBytes(bytes);
    expect(db.getSetting('schema_version')).toBe('8');

    const columns = db.query<{ name: string }>('PRAGMA table_info(loq_resources)').map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['id', 'loq_id', 'person_id', 'start_date', 'finish_date', 'fte']));

    const rows = db.query<{ id: string; fte: number; start_date: string | null; finish_date: string | null }>(
      'SELECT * FROM loq_resources WHERE loq_id = ?', [loqId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'lres_v7_1', fte: 0.5, start_date: null, finish_date: null });

    // The UNIQUE(loq_id, person_id) constraint is gone: a second window for the same pair now inserts fine.
    db.exec(
      'INSERT INTO loq_resources (id, loq_id, person_id, start_date, finish_date, fte) VALUES (?, ?, ?, ?, ?, ?)',
      ['lres_v7_2', loqId, personId, '2026-09-01', '2026-09-15', 1],
    );
    expect(db.query('SELECT * FROM loq_resources WHERE loq_id = ?', [loqId])).toHaveLength(2);
  });

  it('is idempotent when re-opening an already-migrated v8 database', async () => {
    const { bytes, loqId } = await buildV7Bytes();
    const migrated = await PlannerDatabase.openFromBytes(bytes);
    const reopened = await PlannerDatabase.openFromBytes(migrated.export());

    expect(reopened.getSetting('schema_version')).toBe('8');
    expect(reopened.query('SELECT * FROM loq_resources WHERE loq_id = ?', [loqId])).toHaveLength(1);
  });
});
