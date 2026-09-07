import type { NormalizedImport } from '../import/rpmImport';
import {
  createDiscipline,
  createPerson,
  createPool,
  createProject,
  ensureBaseScenario,
  getOrCreatePersonAssignment,
  setPersonAssignmentAllocation,
} from './repository';
import type { PlannerDatabase } from './database';

export type ImportMode = 'replace' | 'merge';

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Writes a NormalizedImport into a database. In 'merge' mode, existing disciplines/pools/
 * people/projects are matched by name and reused; only missing ones are created. In 'replace'
 * mode the caller passes a freshly created, empty database, so everything is created new.
 */
export function applyRpmImport(db: PlannerDatabase, normalized: NormalizedImport, mode: ImportMode): void {
  ensureBaseScenario(db);

  const disciplineIdByName = new Map<string, string>();
  if (mode === 'merge') {
    for (const row of db.query<{ id: string; name: string }>('SELECT id, name FROM disciplines')) {
      disciplineIdByName.set(normalizeKey(row.name), row.id);
    }
  }
  for (const discipline of normalized.disciplines) {
    const key = normalizeKey(discipline.name);
    if (disciplineIdByName.has(key)) continue;
    const created = createDiscipline(db, { name: discipline.name, color: '#6b7280' });
    disciplineIdByName.set(key, created.id);
  }

  const poolIdByName = new Map<string, string>();
  if (mode === 'merge') {
    for (const row of db.query<{ id: string; name: string }>('SELECT id, name FROM resource_pools')) {
      poolIdByName.set(normalizeKey(row.name), row.id);
    }
  }
  for (const pool of normalized.pools) {
    const key = normalizeKey(pool.name);
    if (poolIdByName.has(key)) continue;
    const disciplineId = pool.disciplineName ? disciplineIdByName.get(normalizeKey(pool.disciplineName)) ?? null : null;
    const created = createPool(db, { name: pool.name, capacityFte: 0, color: pool.color, disciplineId });
    poolIdByName.set(key, created.id);
  }

  const personIdByName = new Map<string, string>();
  if (mode === 'merge') {
    for (const row of db.query<{ id: string; name: string }>('SELECT id, name FROM people')) {
      personIdByName.set(normalizeKey(row.name), row.id);
    }
  }
  for (const person of normalized.people) {
    const key = normalizeKey(person.name);
    if (personIdByName.has(key)) continue;
    const poolId = poolIdByName.get(normalizeKey(person.poolName)) ?? null;
    const created = createPerson(db, { name: person.name, poolId, capacityFte: 1, active: true, notes: '' });
    personIdByName.set(key, created.id);
  }

  const projectIdByName = new Map<string, string>();
  if (mode === 'merge') {
    for (const row of db.query<{ id: string; name: string }>('SELECT id, name FROM projects')) {
      projectIdByName.set(normalizeKey(row.name), row.id);
    }
  }
  for (const project of normalized.projects) {
    const key = normalizeKey(project.name);
    if (projectIdByName.has(key)) continue;
    const created = createProject(db, {
      name: project.name,
      status: 'active',
      startDate: project.startDate,
      startCertainty: project.startDate ? 'estimated' : 'tbd',
      endDate: project.endDate,
      endCertainty: project.endDate ? 'estimated' : 'tbd',
      priority: 'medium',
      notes: '',
    });
    projectIdByName.set(key, created.id);
  }

  for (const group of normalized.assignments) {
    const projectId = projectIdByName.get(normalizeKey(group.projectName));
    const personId = personIdByName.get(normalizeKey(group.personName));
    if (!projectId || !personId) continue; // shouldn't happen — every group's names were just created/matched above
    const asn = getOrCreatePersonAssignment(db, personId, projectId);
    for (const allocation of group.allocations) {
      setPersonAssignmentAllocation(db, asn.id, allocation.period, allocation.fte);
    }
  }
}
