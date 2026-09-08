import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { PlannerDatabase } from '../src/db/database';
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

    expect(db.getSetting('schema_version')).toBe('4');
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
    expect(db.getSetting('schema_version')).toBe('4');
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='assignments'")).toHaveLength(0);
    expect(db.query('SELECT * FROM people')).toHaveLength(0);
  });

  it('is idempotent when re-opening an already-migrated v2 database', async () => {
    const { bytes, poolId } = await buildV1Bytes();
    const migrated = await PlannerDatabase.openFromBytes(bytes);
    const reopened = await PlannerDatabase.openFromBytes(migrated.export());

    expect(reopened.getSetting('schema_version')).toBe('4');
    const people = reopened.query('SELECT * FROM people');
    expect(people).toHaveLength(1);

    const data = loadPlanningData(reopened);
    const engine = new PlanningEngine(data, BASE_SCENARIO_ID);
    expect(engine.getCapacity(poolId, '2026-09')).toBe(8);
    expect(engine.getAssignedCapacity(poolId, '2026-09')).toBe(2);
  });
});
