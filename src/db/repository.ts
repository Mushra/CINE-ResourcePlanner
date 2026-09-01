import type {
  Assignment,
  AssignmentAllocation,
  DateCertainty,
  PlanningData,
  Period,
  Priority,
  Project,
  ProjectStatus,
  Requirement,
  RequirementAllocation,
  ResourcePool,
  Scenario,
} from '../domain/types';
import type { PlannerDatabase } from './database';

export const BASE_SCENARIO_ID = 'base';

function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function ensureBaseScenario(db: PlannerDatabase): void {
  const rows = db.query<{ id: string }>('SELECT id FROM scenarios WHERE is_base = 1 LIMIT 1');
  if (rows.length === 0) {
    db.exec('INSERT INTO scenarios (id, name, is_base) VALUES (?, ?, 1)', [BASE_SCENARIO_ID, 'Current Plan']);
  }
}

/** Reads the entire plan (all tables) into a PlanningData snapshot for the engine. */
export function loadPlanningData(db: PlannerDatabase): PlanningData {
  ensureBaseScenario(db);

  const projects = db
    .query<{
      id: string; name: string; status: string; start_date: string | null; start_certainty: string;
      end_date: string | null; end_certainty: string; priority: string; notes: string; sort_order: number;
    }>('SELECT * FROM projects ORDER BY sort_order, name')
    .map((r): Project => ({
      id: r.id,
      name: r.name,
      status: r.status as ProjectStatus,
      startDate: r.start_date,
      startCertainty: r.start_certainty as DateCertainty,
      endDate: r.end_date,
      endCertainty: r.end_certainty as DateCertainty,
      priority: r.priority as Priority,
      notes: r.notes,
      sortOrder: r.sort_order,
    }));

  const pools = db
    .query<{ id: string; name: string; capacity_fte: number; color: string; sort_order: number }>(
      'SELECT * FROM resource_pools ORDER BY sort_order, name',
    )
    .map((r): ResourcePool => ({ id: r.id, name: r.name, capacityFte: r.capacity_fte, color: r.color, sortOrder: r.sort_order }));

  const poolCapacityOverrides = db
    .query<{ pool_id: string; period: string; capacity_fte: number }>('SELECT * FROM pool_capacity_overrides')
    .map((r) => ({ poolId: r.pool_id, period: r.period, capacityFte: r.capacity_fte }));

  const scenarios = db
    .query<{ id: string; name: string; is_base: number }>('SELECT * FROM scenarios')
    .map((r): Scenario => ({ id: r.id, name: r.name, isBase: r.is_base === 1 }));

  const requirements = db
    .query<{ id: string; project_id: string; pool_id: string; scenario_id: string }>('SELECT * FROM requirements')
    .map((r): Requirement => ({ id: r.id, projectId: r.project_id, poolId: r.pool_id, scenarioId: r.scenario_id }));

  const requirementAllocations = db
    .query<{ requirement_id: string; period: string; fte: number }>('SELECT * FROM requirement_allocations')
    .map((r): RequirementAllocation => ({ requirementId: r.requirement_id, period: r.period, fte: r.fte }));

  const assignments = db
    .query<{ id: string; project_id: string; pool_id: string; scenario_id: string }>('SELECT * FROM assignments')
    .map((r): Assignment => ({ id: r.id, projectId: r.project_id, poolId: r.pool_id, scenarioId: r.scenario_id }));

  const assignmentAllocations = db
    .query<{ assignment_id: string; period: string; fte: number }>('SELECT * FROM assignment_allocations')
    .map((r): AssignmentAllocation => ({ assignmentId: r.assignment_id, period: r.period, fte: r.fte }));

  return {
    projects,
    pools,
    poolCapacityOverrides,
    scenarios,
    requirements,
    requirementAllocations,
    assignments,
    assignmentAllocations,
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function createProject(db: PlannerDatabase, input: Omit<Project, 'id' | 'sortOrder'>): Project {
  const id = newId('proj');
  const maxOrder = db.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM projects')[0]?.m ?? -1;
  db.exec(
    `INSERT INTO projects (id, name, status, start_date, start_certainty, end_date, end_certainty, priority, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.status, input.startDate, input.startCertainty, input.endDate, input.endCertainty, input.priority, input.notes, maxOrder + 1],
  );
  return { ...input, id, sortOrder: maxOrder + 1 };
}

export function updateProject(db: PlannerDatabase, project: Project): void {
  db.exec(
    `UPDATE projects SET name=?, status=?, start_date=?, start_certainty=?, end_date=?, end_certainty=?, priority=?, notes=?, sort_order=? WHERE id=?`,
    [project.name, project.status, project.startDate, project.startCertainty, project.endDate, project.endCertainty, project.priority, project.notes, project.sortOrder, project.id],
  );
}

export function deleteProject(db: PlannerDatabase, projectId: string): void {
  db.exec('DELETE FROM projects WHERE id = ?', [projectId]);
}

// ---------------------------------------------------------------------------
// Resource pools
// ---------------------------------------------------------------------------

export function createPool(db: PlannerDatabase, input: Omit<ResourcePool, 'id' | 'sortOrder'>): ResourcePool {
  const id = newId('pool');
  const maxOrder = db.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM resource_pools')[0]?.m ?? -1;
  db.exec('INSERT INTO resource_pools (id, name, capacity_fte, color, sort_order) VALUES (?, ?, ?, ?, ?)', [
    id, input.name, input.capacityFte, input.color, maxOrder + 1,
  ]);
  return { ...input, id, sortOrder: maxOrder + 1 };
}

export function updatePool(db: PlannerDatabase, pool: ResourcePool): void {
  db.exec('UPDATE resource_pools SET name=?, capacity_fte=?, color=?, sort_order=? WHERE id=?', [
    pool.name, pool.capacityFte, pool.color, pool.sortOrder, pool.id,
  ]);
}

export function deletePool(db: PlannerDatabase, poolId: string): void {
  db.exec('DELETE FROM resource_pools WHERE id = ?', [poolId]);
}

export function setPoolCapacityOverride(db: PlannerDatabase, poolId: string, period: Period, capacityFte: number | null): void {
  if (capacityFte === null) {
    db.exec('DELETE FROM pool_capacity_overrides WHERE pool_id = ? AND period = ?', [poolId, period]);
    return;
  }
  db.exec(
    `INSERT INTO pool_capacity_overrides (pool_id, period, capacity_fte) VALUES (?, ?, ?)
     ON CONFLICT(pool_id, period) DO UPDATE SET capacity_fte = excluded.capacity_fte`,
    [poolId, period, capacityFte],
  );
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export function getOrCreateRequirement(db: PlannerDatabase, projectId: string, poolId: string, scenarioId = BASE_SCENARIO_ID): Requirement {
  const existing = db.query<{ id: string }>(
    'SELECT id FROM requirements WHERE project_id = ? AND pool_id = ? AND scenario_id = ?',
    [projectId, poolId, scenarioId],
  )[0];
  if (existing) return { id: existing.id, projectId, poolId, scenarioId };
  const id = newId('req');
  db.exec('INSERT INTO requirements (id, project_id, pool_id, scenario_id) VALUES (?, ?, ?, ?)', [id, projectId, poolId, scenarioId]);
  return { id, projectId, poolId, scenarioId };
}

export function setRequirementAllocation(db: PlannerDatabase, requirementId: string, period: Period, fte: number): void {
  if (fte <= 0) {
    db.exec('DELETE FROM requirement_allocations WHERE requirement_id = ? AND period = ?', [requirementId, period]);
    return;
  }
  db.exec(
    `INSERT INTO requirement_allocations (requirement_id, period, fte) VALUES (?, ?, ?)
     ON CONFLICT(requirement_id, period) DO UPDATE SET fte = excluded.fte`,
    [requirementId, period, fte],
  );
}

export function deleteRequirement(db: PlannerDatabase, requirementId: string): void {
  db.exec('DELETE FROM requirements WHERE id = ?', [requirementId]);
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export function getOrCreateAssignment(db: PlannerDatabase, projectId: string, poolId: string, scenarioId = BASE_SCENARIO_ID): Assignment {
  const existing = db.query<{ id: string }>(
    'SELECT id FROM assignments WHERE project_id = ? AND pool_id = ? AND scenario_id = ?',
    [projectId, poolId, scenarioId],
  )[0];
  if (existing) return { id: existing.id, projectId, poolId, scenarioId };
  const id = newId('asn');
  db.exec('INSERT INTO assignments (id, project_id, pool_id, scenario_id) VALUES (?, ?, ?, ?)', [id, projectId, poolId, scenarioId]);
  return { id, projectId, poolId, scenarioId };
}

export function setAssignmentAllocation(db: PlannerDatabase, assignmentId: string, period: Period, fte: number): void {
  if (fte <= 0) {
    db.exec('DELETE FROM assignment_allocations WHERE assignment_id = ? AND period = ?', [assignmentId, period]);
    return;
  }
  db.exec(
    `INSERT INTO assignment_allocations (assignment_id, period, fte) VALUES (?, ?, ?)
     ON CONFLICT(assignment_id, period) DO UPDATE SET fte = excluded.fte`,
    [assignmentId, period, fte],
  );
}

export function deleteAssignment(db: PlannerDatabase, assignmentId: string): void {
  db.exec('DELETE FROM assignments WHERE id = ?', [assignmentId]);
}
