import type {
  DateCertainty,
  Discipline,
  Person,
  PersonAssignment,
  PersonAssignmentAllocation,
  PlanningData,
  Period,
  Priority,
  Project,
  ProjectStatus,
  Requirement,
  RequirementAllocation,
  ResourcePool,
  Scenario,
  StructureOverride,
  StructureOverrideKind,
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
      is_dispo: number;
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
      isDispo: r.is_dispo === 1,
    }));

  const pools = db
    .query<{ id: string; name: string; capacity_fte: number; color: string; sort_order: number; discipline_id: string | null }>(
      'SELECT * FROM resource_pools ORDER BY sort_order, name',
    )
    .map((r): ResourcePool => ({
      id: r.id, name: r.name, capacityFte: r.capacity_fte, color: r.color, sortOrder: r.sort_order,
      disciplineId: r.discipline_id,
    }));

  const poolCapacityOverrides = db
    .query<{ pool_id: string; period: string; capacity_fte: number }>('SELECT * FROM pool_capacity_overrides')
    .map((r) => ({ poolId: r.pool_id, period: r.period, capacityFte: r.capacity_fte }));

  const disciplines = db
    .query<{ id: string; name: string; color: string; sort_order: number }>('SELECT * FROM disciplines ORDER BY sort_order, name')
    .map((r): Discipline => ({ id: r.id, name: r.name, color: r.color, sortOrder: r.sort_order }));

  const people = db
    .query<{ id: string; name: string; pool_id: string | null; capacity_fte: number; active: number; notes: string; sort_order: number; team: string; site: string }>(
      'SELECT * FROM people ORDER BY sort_order, name',
    )
    .map((r): Person => ({
      id: r.id, name: r.name, poolId: r.pool_id, capacityFte: r.capacity_fte, active: r.active === 1,
      notes: r.notes, sortOrder: r.sort_order, team: r.team, site: r.site,
    }));

  const scenarios = db
    .query<{ id: string; name: string; is_base: number }>('SELECT * FROM scenarios')
    .map((r): Scenario => ({ id: r.id, name: r.name, isBase: r.is_base === 1 }));

  const requirements = db
    .query<{ id: string; project_id: string; pool_id: string; scenario_id: string }>('SELECT * FROM requirements')
    .map((r): Requirement => ({ id: r.id, projectId: r.project_id, poolId: r.pool_id, scenarioId: r.scenario_id }));

  const requirementAllocations = db
    .query<{ requirement_id: string; period: string; fte: number }>('SELECT * FROM requirement_allocations')
    .map((r): RequirementAllocation => ({ requirementId: r.requirement_id, period: r.period, fte: r.fte }));

  const personAssignments = db
    .query<{ id: string; person_id: string; project_id: string; scenario_id: string }>('SELECT * FROM person_assignments')
    .map((r): PersonAssignment => ({ id: r.id, personId: r.person_id, projectId: r.project_id, scenarioId: r.scenario_id }));

  const personAssignmentAllocations = db
    .query<{ person_assignment_id: string; period: string; fte: number }>('SELECT * FROM person_assignment_allocations')
    .map((r): PersonAssignmentAllocation => ({ personAssignmentId: r.person_assignment_id, period: r.period, fte: r.fte }));

  const structureOverrides = db
    .query<{ id: string; kind: string; source_key: string; target_key: string }>('SELECT * FROM structure_overrides')
    .map((r): StructureOverride => ({ id: r.id, kind: r.kind as StructureOverrideKind, sourceKey: r.source_key, targetKey: r.target_key }));

  return {
    projects,
    pools,
    poolCapacityOverrides,
    disciplines,
    people,
    scenarios,
    requirements,
    requirementAllocations,
    personAssignments,
    personAssignmentAllocations,
    structureOverrides,
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function createProject(db: PlannerDatabase, input: Omit<Project, 'id' | 'sortOrder'>): Project {
  const id = newId('proj');
  const maxOrder = db.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM projects')[0]?.m ?? -1;
  db.exec(
    `INSERT INTO projects (id, name, status, start_date, start_certainty, end_date, end_certainty, priority, notes, sort_order, is_dispo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.status, input.startDate, input.startCertainty, input.endDate, input.endCertainty, input.priority, input.notes, maxOrder + 1, input.isDispo ? 1 : 0],
  );
  return { ...input, id, sortOrder: maxOrder + 1 };
}

export function updateProject(db: PlannerDatabase, project: Project): void {
  db.exec(
    `UPDATE projects SET name=?, status=?, start_date=?, start_certainty=?, end_date=?, end_certainty=?, priority=?, notes=?, sort_order=?, is_dispo=? WHERE id=?`,
    [project.name, project.status, project.startDate, project.startCertainty, project.endDate, project.endCertainty, project.priority, project.notes, project.sortOrder, project.isDispo ? 1 : 0, project.id],
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
  db.exec('INSERT INTO resource_pools (id, name, capacity_fte, color, sort_order, discipline_id) VALUES (?, ?, ?, ?, ?, ?)', [
    id, input.name, input.capacityFte, input.color, maxOrder + 1, input.disciplineId,
  ]);
  return { ...input, id, sortOrder: maxOrder + 1 };
}

export function updatePool(db: PlannerDatabase, pool: ResourcePool): void {
  db.exec('UPDATE resource_pools SET name=?, capacity_fte=?, color=?, sort_order=?, discipline_id=? WHERE id=?', [
    pool.name, pool.capacityFte, pool.color, pool.sortOrder, pool.disciplineId, pool.id,
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

/** Sets the same FTE across many periods for one requirement in a single batched write. */
export function setRequirementAllocations(db: PlannerDatabase, requirementId: string, periods: Period[], fte: number): void {
  if (periods.length === 0) return;
  if (fte <= 0) {
    db.execMany('DELETE FROM requirement_allocations WHERE requirement_id = ? AND period = ?', periods.map((period) => [requirementId, period]));
    return;
  }
  db.execMany(
    `INSERT INTO requirement_allocations (requirement_id, period, fte) VALUES (?, ?, ?)
     ON CONFLICT(requirement_id, period) DO UPDATE SET fte = excluded.fte`,
    periods.map((period) => [requirementId, period, fte]),
  );
}

// ---------------------------------------------------------------------------
// Disciplines
// ---------------------------------------------------------------------------

export function createDiscipline(db: PlannerDatabase, input: Omit<Discipline, 'id' | 'sortOrder'>): Discipline {
  const id = newId('disc');
  const maxOrder = db.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM disciplines')[0]?.m ?? -1;
  db.exec('INSERT INTO disciplines (id, name, color, sort_order) VALUES (?, ?, ?, ?)', [id, input.name, input.color, maxOrder + 1]);
  return { ...input, id, sortOrder: maxOrder + 1 };
}

export function updateDiscipline(db: PlannerDatabase, discipline: Discipline): void {
  db.exec('UPDATE disciplines SET name=?, color=?, sort_order=? WHERE id=?', [
    discipline.name, discipline.color, discipline.sortOrder, discipline.id,
  ]);
}

export function deleteDiscipline(db: PlannerDatabase, disciplineId: string): void {
  db.exec('DELETE FROM disciplines WHERE id = ?', [disciplineId]);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function createPerson(db: PlannerDatabase, input: Omit<Person, 'id' | 'sortOrder'>): Person {
  const id = newId('person');
  const maxOrder = db.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM people')[0]?.m ?? -1;
  db.exec('INSERT INTO people (id, name, pool_id, capacity_fte, active, notes, sort_order, team, site) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    id, input.name, input.poolId, input.capacityFte, input.active ? 1 : 0, input.notes, maxOrder + 1, input.team, input.site,
  ]);
  return { ...input, id, sortOrder: maxOrder + 1 };
}

export function updatePerson(db: PlannerDatabase, person: Person): void {
  db.exec('UPDATE people SET name=?, pool_id=?, capacity_fte=?, active=?, notes=?, sort_order=?, team=?, site=? WHERE id=?', [
    person.name, person.poolId, person.capacityFte, person.active ? 1 : 0, person.notes, person.sortOrder, person.team, person.site, person.id,
  ]);
}

export function deletePerson(db: PlannerDatabase, personId: string): void {
  db.exec('DELETE FROM people WHERE id = ?', [personId]);
}

// ---------------------------------------------------------------------------
// Person assignments
// ---------------------------------------------------------------------------

export function getOrCreatePersonAssignment(db: PlannerDatabase, personId: string, projectId: string, scenarioId = BASE_SCENARIO_ID): PersonAssignment {
  const existing = db.query<{ id: string }>(
    'SELECT id FROM person_assignments WHERE person_id = ? AND project_id = ? AND scenario_id = ?',
    [personId, projectId, scenarioId],
  )[0];
  if (existing) return { id: existing.id, personId, projectId, scenarioId };
  const id = newId('pasn');
  db.exec('INSERT INTO person_assignments (id, person_id, project_id, scenario_id) VALUES (?, ?, ?, ?)', [id, personId, projectId, scenarioId]);
  return { id, personId, projectId, scenarioId };
}

export function setPersonAssignmentAllocation(db: PlannerDatabase, personAssignmentId: string, period: Period, fte: number): void {
  if (fte <= 0) {
    db.exec('DELETE FROM person_assignment_allocations WHERE person_assignment_id = ? AND period = ?', [personAssignmentId, period]);
    return;
  }
  db.exec(
    `INSERT INTO person_assignment_allocations (person_assignment_id, period, fte) VALUES (?, ?, ?)
     ON CONFLICT(person_assignment_id, period) DO UPDATE SET fte = excluded.fte`,
    [personAssignmentId, period, fte],
  );
}

export function deletePersonAssignment(db: PlannerDatabase, personAssignmentId: string): void {
  db.exec('DELETE FROM person_assignments WHERE id = ?', [personAssignmentId]);
}

// ---------------------------------------------------------------------------
// Structure overrides — persistent, name-keyed overlay used by the Structure view
// ---------------------------------------------------------------------------

export function upsertStructureOverride(db: PlannerDatabase, kind: StructureOverrideKind, sourceKey: string, targetKey: string): void {
  db.exec(
    `INSERT INTO structure_overrides (id, kind, source_key, target_key) VALUES (?, ?, ?, ?)
     ON CONFLICT(kind, source_key) DO UPDATE SET target_key = excluded.target_key`,
    [newId('sovr'), kind, sourceKey, targetKey],
  );
}

export function deleteStructureOverride(db: PlannerDatabase, overrideId: string): void {
  db.exec('DELETE FROM structure_overrides WHERE id = ?', [overrideId]);
}

/** Removes an override by its (kind, sourceKey) identity rather than its row id — used when an
 * edit reverts an entity back to its frozen, import-matched name. */
export function deleteStructureOverrideByKey(db: PlannerDatabase, kind: StructureOverrideKind, sourceKey: string): void {
  db.exec('DELETE FROM structure_overrides WHERE kind = ? AND source_key = ?', [kind, sourceKey]);
}

/** Sets the same FTE across many periods for one person assignment in a single batched write. */
export function setPersonAssignmentAllocations(db: PlannerDatabase, personAssignmentId: string, periods: Period[], fte: number): void {
  if (periods.length === 0) return;
  if (fte <= 0) {
    db.execMany('DELETE FROM person_assignment_allocations WHERE person_assignment_id = ? AND period = ?', periods.map((period) => [personAssignmentId, period]));
    return;
  }
  db.execMany(
    `INSERT INTO person_assignment_allocations (person_assignment_id, period, fte) VALUES (?, ?, ?)
     ON CONFLICT(person_assignment_id, period) DO UPDATE SET fte = excluded.fte`,
    periods.map((period) => [personAssignmentId, period, fte]),
  );
}
