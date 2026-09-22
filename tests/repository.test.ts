import { describe, expect, it } from 'vitest';
import { PlannerDatabase } from '../src/db/database';
import {
  createCinematic,
  createDependencyTemplate,
  createDiscipline,
  createLoq,
  createLoqCommitmentEvent,
  createLoqDependency,
  createLoqResource,
  createPerson,
  createPersonAssignmentInterval,
  createPool,
  createProject,
  createRequirementInterval,
  createVarianceEvent,
  deleteLoq,
  deleteLoqResource,
  deletePersonAssignmentInterval,
  deleteProject,
  deleteRequirementInterval,
  getOrCreatePersonAssignment,
  getOrCreateRequirement,
  listLoqCommitmentEvents,
  loadPlanningData,
  updateLoqResource,
  updatePersonAssignmentInterval,
  updateRequirementInterval,
  upsertJiraSyncState,
} from '../src/db/repository';

async function seedDisciplineAndProject(db: PlannerDatabase) {
  const discipline = createDiscipline(db, { name: 'Animation', color: '#4f7cff' });
  const project = createProject(db, {
    name: 'Cinematic Alpha', status: 'active', startDate: '2026-09-01', startCertainty: 'confirmed',
    endDate: '2026-12-31', endCertainty: 'confirmed', priority: 'medium', notes: '', isDispo: false,
  });
  return { discipline, project };
}

describe('cinematics/LOQ repository CRUD', () => {
  it('createCinematic/createLoq round-trip via loadPlanningData, with per-project sort_order', async () => {
    const db = await PlannerDatabase.createNew();
    const { discipline, project } = await seedDisciplineAndProject(db);

    const cine1 = createCinematic(db, { projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: '2026-10-15', notes: '' });
    const cine2 = createCinematic(db, { projectId: project.id, name: 'Seq02', jiraKey: null, targetDate: null, notes: '' });
    expect(cine1.sortOrder).toBe(0);
    expect(cine2.sortOrder).toBe(1); // scoped per-project, not a global MAX

    const loq = createLoq(db, {
      cinematicId: cine1.id, disciplineId: discipline.id, jiraKey: null, type: 'L1', status: 'TODO',
      estimateDays: 5, committedStart: null, committedFinish: null, actualFinish: null, dodRef: '',
    });
    expect(loq.status).toBe('TODO');

    const data = loadPlanningData(db);
    expect(data.cinematics.map((c) => c.id)).toEqual(expect.arrayContaining([cine1.id, cine2.id]));
    const loadedLoq = data.loqs.find((l) => l.id === loq.id);
    expect(loadedLoq).toMatchObject({ cinematicId: cine1.id, disciplineId: discipline.id, type: 'L1', status: 'TODO' });
  });

  it('deleteProject cascades cinematics/LOQs and every LOQ child table', async () => {
    const db = await PlannerDatabase.createNew();
    const { discipline, project } = await seedDisciplineAndProject(db);
    const person = createPerson(db, { name: 'Alice', poolId: null, capacityFte: 1, active: true, notes: '', team: '', site: '' });

    const cinematic = createCinematic(db, { projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: null, notes: '' });
    const loqA = createLoq(db, {
      cinematicId: cinematic.id, disciplineId: discipline.id, jiraKey: null, type: 'L1', status: 'TODO',
      estimateDays: null, committedStart: null, committedFinish: null, actualFinish: null, dodRef: '',
    });
    const loqB = createLoq(db, {
      cinematicId: cinematic.id, disciplineId: discipline.id, jiraKey: null, type: 'L2', status: 'TODO',
      estimateDays: null, committedStart: null, committedFinish: null, actualFinish: null, dodRef: '',
    });

    createLoqResource(db, { loqId: loqA.id, personId: person.id, startDate: null, finishDate: null, fte: 0.5 });
    createLoqCommitmentEvent(db, { loqId: loqA.id, committedStart: '2026-09-01', committedFinish: '2026-09-15', changedBy: 'Alice', changedAt: '2026-09-01T00:00:00Z', reason: '', comment: '' });
    createVarianceEvent(db, { loqId: loqA.id, category: 'scope', comment: '', declaredBy: 'Alice', declaredAt: '2026-09-02T00:00:00Z', committedDateAtDeclaration: null, forecastDateAtDeclaration: null, deltaDays: 2 });
    upsertJiraSyncState(db, { loqId: loqA.id, jiraStatus: 'In Progress', jiraAssignee: 'Alice', jiraUpdatedAt: null, lastSyncedAt: '2026-09-02T00:00:00Z', rawSnapshot: '{}' });
    createLoqDependency(db, { predecessorLoqId: loqA.id, successorLoqId: loqB.id, type: 'finish_to_start', lagDays: 0, source: 'override', templateId: null });

    deleteProject(db, project.id);

    const data = loadPlanningData(db);
    expect(data.projects).toHaveLength(0);
    expect(data.cinematics).toHaveLength(0);
    expect(data.loqs).toHaveLength(0);
    expect(data.loqResources).toHaveLength(0);
    expect(data.loqCommitmentEvents).toHaveLength(0);
    expect(data.varianceEvents).toHaveLength(0);
    expect(data.jiraSyncStates).toHaveLength(0);
    expect(data.loqDependencies).toHaveLength(0);
  });

  it('append-only, upsert, and window shapes: commitment events accumulate, jira upserts in place, resources are per-window rows', async () => {
    const db = await PlannerDatabase.createNew();
    const { discipline, project } = await seedDisciplineAndProject(db);
    const person = createPerson(db, { name: 'Alice', poolId: null, capacityFte: 1, active: true, notes: '', team: '', site: '' });
    const cinematic = createCinematic(db, { projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: null, notes: '' });
    const loq = createLoq(db, {
      cinematicId: cinematic.id, disciplineId: discipline.id, jiraKey: null, type: 'L1', status: 'TODO',
      estimateDays: null, committedStart: null, committedFinish: null, actualFinish: null, dodRef: '',
    });
    const template = createDependencyTemplate(db, {
      predecessorDisciplineId: discipline.id, predecessorLoqType: 'L1', successorDisciplineId: discipline.id, successorLoqType: 'L2', type: 'finish_to_start', lagDays: 0,
    });

    createLoqCommitmentEvent(db, { loqId: loq.id, committedStart: '2026-09-01', committedFinish: '2026-09-10', changedBy: 'Alice', changedAt: '2026-09-01T00:00:00Z', reason: 'initial', comment: '' });
    createLoqCommitmentEvent(db, { loqId: loq.id, committedStart: '2026-09-05', committedFinish: '2026-09-15', changedBy: 'Bob', changedAt: '2026-09-05T00:00:00Z', reason: 'slip', comment: '' });
    const events = listLoqCommitmentEvents(db, loq.id);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.changedBy)).toEqual(['Alice', 'Bob']); // ordered by changed_at

    upsertJiraSyncState(db, { loqId: loq.id, jiraStatus: 'TODO', jiraAssignee: null, jiraUpdatedAt: null, lastSyncedAt: '2026-09-01T00:00:00Z', rawSnapshot: '{}' });
    upsertJiraSyncState(db, { loqId: loq.id, jiraStatus: 'In Progress', jiraAssignee: 'Alice', jiraUpdatedAt: null, lastSyncedAt: '2026-09-05T00:00:00Z', rawSnapshot: '{}' });
    const jiraStates = loadPlanningData(db).jiraSyncStates.filter((s) => s.loqId === loq.id);
    expect(jiraStates).toHaveLength(1);
    expect(jiraStates[0]).toMatchObject({ jiraStatus: 'In Progress', jiraAssignee: 'Alice' });

    // Same (loq, person) pair, two disjoint windows: both rows persist, not an upsert.
    const window1 = createLoqResource(db, { loqId: loq.id, personId: person.id, startDate: '2026-09-01', finishDate: '2026-09-10', fte: 1 });
    const window2 = createLoqResource(db, { loqId: loq.id, personId: person.id, startDate: '2026-11-01', finishDate: '2026-11-10', fte: 0.5 });
    let resources = loadPlanningData(db).loqResources.filter((r) => r.loqId === loq.id);
    expect(resources).toHaveLength(2);
    expect(resources.map((r) => ({ startDate: r.startDate, finishDate: r.finishDate, fte: r.fte }))).toEqual(
      expect.arrayContaining([
        { startDate: '2026-09-01', finishDate: '2026-09-10', fte: 1 },
        { startDate: '2026-11-01', finishDate: '2026-11-10', fte: 0.5 },
      ]),
    );

    updateLoqResource(db, { ...window2, startDate: '2026-12-01', finishDate: '2026-12-15', fte: 0.75 });
    resources = loadPlanningData(db).loqResources.filter((r) => r.loqId === loq.id);
    const updated = resources.find((r) => r.id === window2.id);
    expect(updated).toMatchObject({ startDate: '2026-12-01', finishDate: '2026-12-15', fte: 0.75 });

    deleteLoqResource(db, window1.id);
    resources = loadPlanningData(db).loqResources.filter((r) => r.loqId === loq.id);
    expect(resources).toHaveLength(1);
    expect(resources[0].id).toBe(window2.id);

    // Materializing the same template edge twice upserts instead of duplicating.
    createLoqDependency(db, { predecessorLoqId: loq.id, successorLoqId: loq.id, type: 'finish_to_start', lagDays: 0, source: 'template', templateId: template.id });
    createLoqDependency(db, { predecessorLoqId: loq.id, successorLoqId: loq.id, type: 'finish_to_start', lagDays: 3, source: 'template', templateId: template.id });
    const dependencies = loadPlanningData(db).loqDependencies.filter((d) => d.predecessorLoqId === loq.id);
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0].lagDays).toBe(3);

    deleteLoq(db, loq.id);
    const afterDelete = loadPlanningData(db);
    expect(afterDelete.loqs).toHaveLength(0);
    expect(afterDelete.loqCommitmentEvents).toHaveLength(0);
    expect(afterDelete.loqDependencies).toHaveLength(0);
  });
});

describe('requirement/person-assignment interval CRUD (day-precise allocations)', () => {
  it('createRequirementInterval/updateRequirementInterval/deleteRequirementInterval round-trip via loadPlanningData', async () => {
    const db = await PlannerDatabase.createNew();
    const { discipline, project } = await seedDisciplineAndProject(db);
    const pool = createPool(db, { name: 'Animation - Generic', disciplineId: discipline.id, capacityFte: 0, color: '#4f7cff' });
    const req = getOrCreateRequirement(db, project.id, pool.id);

    const interval = createRequirementInterval(db, { requirementId: req.id, startDate: '2026-04-12', finishDate: '2026-05-31', fte: 1 });
    let allocs = loadPlanningData(db).requirementAllocations.filter((a) => a.requirementId === req.id);
    expect(allocs).toEqual([{ id: interval.id, requirementId: req.id, startDate: '2026-04-12', finishDate: '2026-05-31', fte: 1 }]);

    updateRequirementInterval(db, { ...interval, startDate: '2026-04-13', fte: 0.5 });
    allocs = loadPlanningData(db).requirementAllocations.filter((a) => a.requirementId === req.id);
    expect(allocs).toEqual([{ id: interval.id, requirementId: req.id, startDate: '2026-04-13', finishDate: '2026-05-31', fte: 0.5 }]);

    deleteRequirementInterval(db, interval.id);
    allocs = loadPlanningData(db).requirementAllocations.filter((a) => a.requirementId === req.id);
    expect(allocs).toHaveLength(0);
  });

  it('createPersonAssignmentInterval/updatePersonAssignmentInterval/deletePersonAssignmentInterval round-trip, multiple disjoint intervals per assignment', async () => {
    const db = await PlannerDatabase.createNew();
    const { project } = await seedDisciplineAndProject(db);
    const person = createPerson(db, { name: 'Alice', poolId: null, capacityFte: 1, active: true, notes: '', team: '', site: '' });
    const asn = getOrCreatePersonAssignment(db, person.id, project.id);

    const iv1 = createPersonAssignmentInterval(db, { personAssignmentId: asn.id, startDate: '2026-04-12', finishDate: '2026-06-30', fte: 1 });
    const iv2 = createPersonAssignmentInterval(db, { personAssignmentId: asn.id, startDate: '2026-09-01', finishDate: '2026-09-30', fte: 0.5 });
    let allocs = loadPlanningData(db).personAssignmentAllocations.filter((a) => a.personAssignmentId === asn.id);
    expect(allocs).toHaveLength(2);

    updatePersonAssignmentInterval(db, { ...iv2, finishDate: '2026-10-15', fte: 0.75 });
    allocs = loadPlanningData(db).personAssignmentAllocations.filter((a) => a.personAssignmentId === asn.id);
    expect(allocs.find((a) => a.id === iv2.id)).toMatchObject({ finishDate: '2026-10-15', fte: 0.75 });
    expect(allocs.find((a) => a.id === iv1.id)).toMatchObject({ startDate: '2026-04-12', finishDate: '2026-06-30', fte: 1 });

    deletePersonAssignmentInterval(db, iv1.id);
    allocs = loadPlanningData(db).personAssignmentAllocations.filter((a) => a.personAssignmentId === asn.id);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].id).toBe(iv2.id);
  });
});
