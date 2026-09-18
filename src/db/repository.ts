import type {
  Cinematic,
  DateCertainty,
  DependencySource,
  DependencyTemplate,
  DependencyType,
  Discipline,
  JiraSyncState,
  Loq,
  LoqCommitmentEvent,
  LoqDependency,
  LoqResource,
  LoqStatus,
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
  VarianceEvent,
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

  const cinematics = db
    .query<{ id: string; project_id: string; name: string; target_date: string | null; sort_order: number; notes: string }>(
      'SELECT * FROM cinematics ORDER BY sort_order, name',
    )
    .map((r): Cinematic => ({ id: r.id, projectId: r.project_id, name: r.name, targetDate: r.target_date, sortOrder: r.sort_order, notes: r.notes }));

  const loqs = db
    .query<{
      id: string; cinematic_id: string; discipline_id: string; jira_key: string | null; type: string; status: string;
      estimate_days: number | null; committed_start: string | null; committed_finish: string | null; actual_finish: string | null;
      dod_ref: string; sort_order: number;
    }>('SELECT * FROM loqs ORDER BY sort_order')
    .map((r): Loq => ({
      id: r.id, cinematicId: r.cinematic_id, disciplineId: r.discipline_id, jiraKey: r.jira_key, type: r.type,
      status: r.status as LoqStatus, estimateDays: r.estimate_days, committedStart: r.committed_start, committedFinish: r.committed_finish,
      actualFinish: r.actual_finish, dodRef: r.dod_ref, sortOrder: r.sort_order,
    }));

  const loqCommitmentEvents = db
    .query<{ id: string; loq_id: string; committed_start: string | null; committed_finish: string | null; changed_by: string; changed_at: string; reason: string; comment: string }>(
      'SELECT * FROM loq_commitment_events ORDER BY changed_at',
    )
    .map((r): LoqCommitmentEvent => ({
      id: r.id, loqId: r.loq_id, committedStart: r.committed_start, committedFinish: r.committed_finish,
      changedBy: r.changed_by, changedAt: r.changed_at, reason: r.reason, comment: r.comment,
    }));

  const loqResources = db
    .query<{ id: string; loq_id: string; person_id: string; start_date: string | null; finish_date: string | null; fte: number }>(
      'SELECT * FROM loq_resources',
    )
    .map((r): LoqResource => ({
      id: r.id, loqId: r.loq_id, personId: r.person_id, startDate: r.start_date, finishDate: r.finish_date, fte: r.fte,
    }));

  const loqDependencies = db
    .query<{ id: string; predecessor_loq_id: string; successor_loq_id: string; type: string; lag_days: number; source: string; template_id: string | null }>(
      'SELECT * FROM loq_dependencies',
    )
    .map((r): LoqDependency => ({
      id: r.id, predecessorLoqId: r.predecessor_loq_id, successorLoqId: r.successor_loq_id,
      type: r.type as DependencyType, lagDays: r.lag_days, source: r.source as DependencySource, templateId: r.template_id,
    }));

  const dependencyTemplates = db
    .query<{
      id: string; predecessor_discipline_id: string; predecessor_loq_type: string;
      successor_discipline_id: string; successor_loq_type: string; type: string; lag_days: number;
    }>('SELECT * FROM dependency_templates')
    .map((r): DependencyTemplate => ({
      id: r.id, predecessorDisciplineId: r.predecessor_discipline_id, predecessorLoqType: r.predecessor_loq_type,
      successorDisciplineId: r.successor_discipline_id, successorLoqType: r.successor_loq_type,
      type: r.type as DependencyType, lagDays: r.lag_days,
    }));

  const varianceEvents = db
    .query<{
      id: string; loq_id: string; category: string; comment: string; declared_by: string; declared_at: string;
      committed_date_at_declaration: string | null; forecast_date_at_declaration: string | null; delta_days: number;
    }>('SELECT * FROM variance_events ORDER BY declared_at')
    .map((r): VarianceEvent => ({
      id: r.id, loqId: r.loq_id, category: r.category, comment: r.comment, declaredBy: r.declared_by, declaredAt: r.declared_at,
      committedDateAtDeclaration: r.committed_date_at_declaration, forecastDateAtDeclaration: r.forecast_date_at_declaration,
      deltaDays: r.delta_days,
    }));

  const jiraSyncStates = db
    .query<{ loq_id: string; jira_status: string | null; jira_assignee: string | null; jira_updated_at: string | null; last_synced_at: string; raw_snapshot: string }>(
      'SELECT * FROM jira_sync_state',
    )
    .map((r): JiraSyncState => ({
      loqId: r.loq_id, jiraStatus: r.jira_status, jiraAssignee: r.jira_assignee, jiraUpdatedAt: r.jira_updated_at,
      lastSyncedAt: r.last_synced_at, rawSnapshot: r.raw_snapshot,
    }));

  return {
    projects,
    pools,
    disciplines,
    people,
    scenarios,
    requirements,
    requirementAllocations,
    personAssignments,
    personAssignmentAllocations,
    structureOverrides,
    cinematics,
    loqs,
    loqCommitmentEvents,
    loqResources,
    loqDependencies,
    dependencyTemplates,
    varianceEvents,
    jiraSyncStates,
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

/** Deletes a project and everything hanging off it — requirements/assignments declare ON DELETE
 * CASCADE but sql.js doesn't enforce it, so without this cleanup their allocations linger as
 * phantom FTE that keeps inflating other totals forever (the same bug class fixed for
 * pools/disciplines/people; projects were missed). There's no "orphan to a bucket" choice here
 * (unlike deletePool/deleteDiscipline) since there's no equivalent of "Unassigned" for a project's
 * own requirements/assignments — deleting a project always takes its staffing data with it.
 * Also cascades the project's cinematics (and everything under each of their LOQs) via
 * deleteCinematic, so that single cascade lives in one place. */
export function deleteProject(db: PlannerDatabase, projectId: string): void {
  db.exec('DELETE FROM requirement_allocations WHERE requirement_id IN (SELECT id FROM requirements WHERE project_id = ?)', [projectId]);
  db.exec('DELETE FROM requirements WHERE project_id = ?', [projectId]);
  db.exec('DELETE FROM person_assignment_allocations WHERE person_assignment_id IN (SELECT id FROM person_assignments WHERE project_id = ?)', [projectId]);
  db.exec('DELETE FROM person_assignments WHERE project_id = ?', [projectId]);
  const cinematicIds = db.query<{ id: string }>('SELECT id FROM cinematics WHERE project_id = ?', [projectId]).map((r) => r.id);
  for (const cinematicId of cinematicIds) deleteCinematic(db, cinematicId);
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

/** Deletes just the role itself — its people fall back to "no role" (like any other pool-less
 * person) rather than vanishing, and its now-pointless requirements are cleaned up explicitly
 * since sql.js doesn't enforce the schema's declared CASCADE/SET NULL. */
export function deletePool(db: PlannerDatabase, poolId: string): void {
  db.exec('UPDATE people SET pool_id = NULL WHERE pool_id = ?', [poolId]);
  db.exec('DELETE FROM requirement_allocations WHERE requirement_id IN (SELECT id FROM requirements WHERE pool_id = ?)', [poolId]);
  db.exec('DELETE FROM requirements WHERE pool_id = ?', [poolId]);
  db.exec('DELETE FROM resource_pools WHERE id = ?', [poolId]);
}

/** Deletes the role AND every person in it (each with their own assignments) — for the "delete
 * everything under here too" choice in the Team delete-confirmation prompt. */
export function deletePoolCascade(db: PlannerDatabase, poolId: string): void {
  const personIds = db.query<{ id: string }>('SELECT id FROM people WHERE pool_id = ?', [poolId]).map((r) => r.id);
  for (const personId of personIds) deletePerson(db, personId);
  deletePool(db, poolId);
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
  // sql.js doesn't enforce the `ON DELETE SET NULL` declared on resource_pools.discipline_id
  // (foreign_keys pragma is off by default), so do it ourselves — otherwise pools keep pointing
  // at the deleted id and linger in project timelines under a broken label instead of falling
  // back to the "Unassigned" bucket like any other discipline-less pool.
  db.exec('UPDATE resource_pools SET discipline_id = NULL WHERE discipline_id = ?', [disciplineId]);
  db.exec('DELETE FROM disciplines WHERE id = ?', [disciplineId]);
}

/** Deletes the discipline AND every role under it (each with its own people/assignments) — for
 * the "delete everything under here too" choice in the Team delete-confirmation prompt. */
export function deleteDisciplineCascade(db: PlannerDatabase, disciplineId: string): void {
  const poolIds = db.query<{ id: string }>('SELECT id FROM resource_pools WHERE discipline_id = ?', [disciplineId]).map((r) => r.id);
  for (const poolId of poolIds) deletePoolCascade(db, poolId);
  deleteDiscipline(db, disciplineId);
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
  // person_assignments/person_assignment_allocations declare ON DELETE CASCADE but sql.js doesn't
  // enforce it — clean them up explicitly, otherwise the deleted person's assignments linger as
  // phantom FTE that keeps inflating a project's staffed total forever.
  db.exec('DELETE FROM person_assignment_allocations WHERE person_assignment_id IN (SELECT id FROM person_assignments WHERE person_id = ?)', [personId]);
  db.exec('DELETE FROM person_assignments WHERE person_id = ?', [personId]);
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
// Structure overrides — persistent, name-keyed overlay used by Team's Structure & remapping section
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

// ---------------------------------------------------------------------------
// Cinematics — sort_order is scoped per-project (unlike the global MAX used by
// createPool/createProject), since a cinematic is ordered within its project, not plan-wide.
// ---------------------------------------------------------------------------

export function createCinematic(db: PlannerDatabase, input: Omit<Cinematic, 'id' | 'sortOrder'>): Cinematic {
  const id = newId('cine');
  const maxOrder = db.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM cinematics WHERE project_id = ?', [input.projectId])[0]?.m ?? -1;
  db.exec('INSERT INTO cinematics (id, project_id, name, target_date, sort_order, notes) VALUES (?, ?, ?, ?, ?, ?)', [
    id, input.projectId, input.name, input.targetDate, maxOrder + 1, input.notes,
  ]);
  return { ...input, id, sortOrder: maxOrder + 1 };
}

export function updateCinematic(db: PlannerDatabase, cinematic: Cinematic): void {
  db.exec('UPDATE cinematics SET project_id=?, name=?, target_date=?, sort_order=?, notes=? WHERE id=?', [
    cinematic.projectId, cinematic.name, cinematic.targetDate, cinematic.sortOrder, cinematic.notes, cinematic.id,
  ]);
}

/** Deletes the cinematic and every LOQ under it (each with its own resources/history) — mirrors
 * deletePoolCascade/deleteDisciplineCascade. There's no "orphan to a bucket" choice: a LOQ has no
 * meaning outside its cinematic. */
export function deleteCinematic(db: PlannerDatabase, cinematicId: string): void {
  const loqIds = db.query<{ id: string }>('SELECT id FROM loqs WHERE cinematic_id = ?', [cinematicId]).map((r) => r.id);
  for (const loqId of loqIds) deleteLoq(db, loqId);
  db.exec('DELETE FROM cinematics WHERE id = ?', [cinematicId]);
}

// ---------------------------------------------------------------------------
// LOQs — sort_order is scoped per-cinematic, same reasoning as cinematics above.
// ---------------------------------------------------------------------------

export function createLoq(db: PlannerDatabase, input: Omit<Loq, 'id' | 'sortOrder'>): Loq {
  const id = newId('loq');
  const maxOrder = db.query<{ m: number | null }>('SELECT MAX(sort_order) as m FROM loqs WHERE cinematic_id = ?', [input.cinematicId])[0]?.m ?? -1;
  db.exec(
    `INSERT INTO loqs (id, cinematic_id, discipline_id, jira_key, type, status, estimate_days, committed_start, committed_finish, actual_finish, dod_ref, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.cinematicId, input.disciplineId, input.jiraKey, input.type, input.status, input.estimateDays, input.committedStart, input.committedFinish, input.actualFinish, input.dodRef, maxOrder + 1],
  );
  return { ...input, id, sortOrder: maxOrder + 1 };
}

/** Persists every column as given, including the committed_start/finish cache. Recomputing that
 * cache from the newest loq_commitment_events row (rather than trusting the caller) is Phase 2
 * (engine) work — this is a plain field-for-field update. */
export function updateLoq(db: PlannerDatabase, loq: Loq): void {
  db.exec(
    `UPDATE loqs SET cinematic_id=?, discipline_id=?, jira_key=?, type=?, status=?, estimate_days=?, committed_start=?, committed_finish=?, actual_finish=?, dod_ref=?, sort_order=?
     WHERE id=?`,
    [loq.cinematicId, loq.disciplineId, loq.jiraKey, loq.type, loq.status, loq.estimateDays, loq.committedStart, loq.committedFinish, loq.actualFinish, loq.dodRef, loq.sortOrder, loq.id],
  );
}

/** Deletes the LOQ and every row that hangs off it — the single-LOQ analog of deletePerson. */
export function deleteLoq(db: PlannerDatabase, loqId: string): void {
  db.exec('DELETE FROM loq_resources WHERE loq_id = ?', [loqId]);
  db.exec('DELETE FROM loq_commitment_events WHERE loq_id = ?', [loqId]);
  db.exec('DELETE FROM variance_events WHERE loq_id = ?', [loqId]);
  db.exec('DELETE FROM jira_sync_state WHERE loq_id = ?', [loqId]);
  db.exec('DELETE FROM loq_dependencies WHERE predecessor_loq_id = ? OR successor_loq_id = ?', [loqId, loqId]);
  db.exec('DELETE FROM loqs WHERE id = ?', [loqId]);
}

// ---------------------------------------------------------------------------
// LOQ commitment events — append-only audit trail. No update/delete: a correction is a new row,
// removed only as part of deleteLoq's cascade.
// ---------------------------------------------------------------------------

export function createLoqCommitmentEvent(db: PlannerDatabase, input: Omit<LoqCommitmentEvent, 'id'>): LoqCommitmentEvent {
  const id = newId('lce');
  db.exec(
    'INSERT INTO loq_commitment_events (id, loq_id, committed_start, committed_finish, changed_by, changed_at, reason, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.loqId, input.committedStart, input.committedFinish, input.changedBy, input.changedAt, input.reason, input.comment],
  );
  return { ...input, id };
}

export function listLoqCommitmentEvents(db: PlannerDatabase, loqId: string): LoqCommitmentEvent[] {
  return db
    .query<{ id: string; loq_id: string; committed_start: string | null; committed_finish: string | null; changed_by: string; changed_at: string; reason: string; comment: string }>(
      'SELECT * FROM loq_commitment_events WHERE loq_id = ? ORDER BY changed_at',
      [loqId],
    )
    .map((r): LoqCommitmentEvent => ({
      id: r.id, loqId: r.loq_id, committedStart: r.committed_start, committedFinish: r.committed_finish,
      changedBy: r.changed_by, changedAt: r.changed_at, reason: r.reason, comment: r.comment,
    }));
}

// ---------------------------------------------------------------------------
// LOQ resources — one row per assignment window, not one per (loq_id, person_id): a person may
// appear more than once with disjoint windows, so this is id-based create/update/delete rather
// than an upsert keyed on the pair.
// ---------------------------------------------------------------------------

export function createLoqResource(db: PlannerDatabase, input: Omit<LoqResource, 'id'>): LoqResource {
  const id = newId('lres');
  db.exec(
    'INSERT INTO loq_resources (id, loq_id, person_id, start_date, finish_date, fte) VALUES (?, ?, ?, ?, ?, ?)',
    [id, input.loqId, input.personId, input.startDate, input.finishDate, input.fte],
  );
  return { ...input, id };
}

export function updateLoqResource(db: PlannerDatabase, resource: LoqResource): void {
  db.exec(
    'UPDATE loq_resources SET loq_id=?, person_id=?, start_date=?, finish_date=?, fte=? WHERE id=?',
    [resource.loqId, resource.personId, resource.startDate, resource.finishDate, resource.fte, resource.id],
  );
}

export function deleteLoqResource(db: PlannerDatabase, resourceId: string): void {
  db.exec('DELETE FROM loq_resources WHERE id = ?', [resourceId]);
}

// ---------------------------------------------------------------------------
// LOQ dependencies
// ---------------------------------------------------------------------------

/** Upsert on (predecessor, successor) so re-materializing a dependency_template edge is
 * idempotent — creating it again just refreshes type/lag/source/template_id in place. */
export function createLoqDependency(db: PlannerDatabase, input: Omit<LoqDependency, 'id'>): LoqDependency {
  const id = newId('ldep');
  db.exec(
    `INSERT INTO loq_dependencies (id, predecessor_loq_id, successor_loq_id, type, lag_days, source, template_id) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(predecessor_loq_id, successor_loq_id) DO UPDATE SET type = excluded.type, lag_days = excluded.lag_days, source = excluded.source, template_id = excluded.template_id`,
    [id, input.predecessorLoqId, input.successorLoqId, input.type, input.lagDays, input.source, input.templateId],
  );
  return { ...input, id };
}

export function updateLoqDependency(db: PlannerDatabase, dependency: LoqDependency): void {
  db.exec('UPDATE loq_dependencies SET predecessor_loq_id=?, successor_loq_id=?, type=?, lag_days=?, source=?, template_id=? WHERE id=?', [
    dependency.predecessorLoqId, dependency.successorLoqId, dependency.type, dependency.lagDays, dependency.source, dependency.templateId, dependency.id,
  ]);
}

export function deleteLoqDependency(db: PlannerDatabase, dependencyId: string): void {
  db.exec('DELETE FROM loq_dependencies WHERE id = ?', [dependencyId]);
}

// ---------------------------------------------------------------------------
// Dependency templates
// ---------------------------------------------------------------------------

export function createDependencyTemplate(db: PlannerDatabase, input: Omit<DependencyTemplate, 'id'>): DependencyTemplate {
  const id = newId('dtpl');
  db.exec(
    `INSERT INTO dependency_templates (id, predecessor_discipline_id, predecessor_loq_type, successor_discipline_id, successor_loq_type, type, lag_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.predecessorDisciplineId, input.predecessorLoqType, input.successorDisciplineId, input.successorLoqType, input.type, input.lagDays],
  );
  return { ...input, id };
}

export function updateDependencyTemplate(db: PlannerDatabase, template: DependencyTemplate): void {
  db.exec(
    'UPDATE dependency_templates SET predecessor_discipline_id=?, predecessor_loq_type=?, successor_discipline_id=?, successor_loq_type=?, type=?, lag_days=? WHERE id=?',
    [template.predecessorDisciplineId, template.predecessorLoqType, template.successorDisciplineId, template.successorLoqType, template.type, template.lagDays, template.id],
  );
}

/** template_id is ON DELETE SET NULL — an override without a template is still a valid,
 * independently-editable edge, so null the reference (mirrors deleteDiscipline's pattern) rather
 * than deleting the dependency rows themselves. */
export function deleteDependencyTemplate(db: PlannerDatabase, templateId: string): void {
  db.exec('UPDATE loq_dependencies SET template_id = NULL WHERE template_id = ?', [templateId]);
  db.exec('DELETE FROM dependency_templates WHERE id = ?', [templateId]);
}

// ---------------------------------------------------------------------------
// Variance events — append-only, same shape as loq_commitment_events: no update/delete, a
// correction is a new row, removed only as part of deleteLoq's cascade.
// ---------------------------------------------------------------------------

export function createVarianceEvent(db: PlannerDatabase, input: Omit<VarianceEvent, 'id'>): VarianceEvent {
  const id = newId('ve');
  db.exec(
    `INSERT INTO variance_events (id, loq_id, category, comment, declared_by, declared_at, committed_date_at_declaration, forecast_date_at_declaration, delta_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.loqId, input.category, input.comment, input.declaredBy, input.declaredAt, input.committedDateAtDeclaration, input.forecastDateAtDeclaration, input.deltaDays],
  );
  return { ...input, id };
}

export function listVarianceEvents(db: PlannerDatabase, loqId: string): VarianceEvent[] {
  return db
    .query<{
      id: string; loq_id: string; category: string; comment: string; declared_by: string; declared_at: string;
      committed_date_at_declaration: string | null; forecast_date_at_declaration: string | null; delta_days: number;
    }>('SELECT * FROM variance_events WHERE loq_id = ? ORDER BY declared_at', [loqId])
    .map((r): VarianceEvent => ({
      id: r.id, loqId: r.loq_id, category: r.category, comment: r.comment, declaredBy: r.declared_by, declaredAt: r.declared_at,
      committedDateAtDeclaration: r.committed_date_at_declaration, forecastDateAtDeclaration: r.forecast_date_at_declaration,
      deltaDays: r.delta_days,
    }));
}

// ---------------------------------------------------------------------------
// Jira sync state — 1:1 with a LOQ (loq_id is the primary key), so it's upsert-shaped rather than
// create/update.
// ---------------------------------------------------------------------------

export function upsertJiraSyncState(db: PlannerDatabase, state: JiraSyncState): void {
  db.exec(
    `INSERT INTO jira_sync_state (loq_id, jira_status, jira_assignee, jira_updated_at, last_synced_at, raw_snapshot) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(loq_id) DO UPDATE SET jira_status = excluded.jira_status, jira_assignee = excluded.jira_assignee,
       jira_updated_at = excluded.jira_updated_at, last_synced_at = excluded.last_synced_at, raw_snapshot = excluded.raw_snapshot`,
    [state.loqId, state.jiraStatus, state.jiraAssignee, state.jiraUpdatedAt, state.lastSyncedAt, state.rawSnapshot],
  );
}

export function deleteJiraSyncState(db: PlannerDatabase, loqId: string): void {
  db.exec('DELETE FROM jira_sync_state WHERE loq_id = ?', [loqId]);
}
