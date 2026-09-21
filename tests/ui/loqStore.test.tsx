import { describe, expect, it } from 'vitest';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { seedStore } from './harness';

function seedProjectAndDiscipline() {
  const { createDiscipline, createProject } = useStore.getState();
  const discipline = createDiscipline({ name: 'Animation', color: '#4f7cff' });
  const project = createProject({
    name: 'Cinematic Alpha',
    status: 'planned',
    startDate: '2026-09-01',
    startCertainty: 'confirmed',
    endDate: '2026-12-31',
    endCertainty: 'confirmed',
    priority: 'medium',
    notes: '',
    isDispo: false,
  });
  return { discipline, project };
}

describe('useStore — Cinematic CRUD', () => {
  it('creates, updates, and deletes a cinematic', async () => {
    await seedStore();
    const { project } = seedProjectAndDiscipline();
    const { createCinematic, updateCinematic, deleteCinematic } = useStore.getState();

    const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });
    expect(useStore.getState().data.cinematics.find((c) => c.id === cinematic.id)?.name).toBe('Seq01');

    updateCinematic({ ...cinematic, name: 'Seq01 - Renamed' });
    expect(useStore.getState().data.cinematics.find((c) => c.id === cinematic.id)?.name).toBe('Seq01 - Renamed');

    deleteCinematic(cinematic.id);
    expect(useStore.getState().data.cinematics.some((c) => c.id === cinematic.id)).toBe(false);
  });

  it('scopes sortOrder per project', async () => {
    await seedStore();
    const { project } = seedProjectAndDiscipline();
    const { createCinematic } = useStore.getState();

    const first = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });
    const second = createCinematic({ projectId: project.id, name: 'Seq02', targetDate: null, notes: '' });
    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(1);
  });
});

describe('useStore — LOQ CRUD', () => {
  it('creates, updates, and deletes a LOQ', async () => {
    await seedStore();
    const { project, discipline } = seedProjectAndDiscipline();
    const { createCinematic, createLoq, updateLoq, deleteLoq } = useStore.getState();
    const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });

    const loq = createLoq({
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type: 'L1',
      status: 'TODO',
      estimateDays: 4,
      committedStart: '2026-09-01',
      committedFinish: '2026-09-10',
      actualFinish: null,
      dodRef: '',
    });
    expect(useStore.getState().data.loqs.find((l) => l.id === loq.id)?.status).toBe('TODO');

    updateLoq({ ...loq, status: 'IN_PROGRESS' });
    expect(useStore.getState().data.loqs.find((l) => l.id === loq.id)?.status).toBe('IN_PROGRESS');

    deleteLoq(loq.id);
    expect(useStore.getState().data.loqs.some((l) => l.id === loq.id)).toBe(false);
  });

  it('recomputes the engine so bottom-up LOQ demand is visible right after creation', async () => {
    await seedStore();
    const { project, discipline } = seedProjectAndDiscipline();
    const { createCinematic, createLoq } = useStore.getState();
    const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });

    createLoq({
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type: 'L1',
      status: 'TODO',
      estimateDays: 8,
      // 2026-09-01 (Tue) .. 2026-09-10 (Thu) = 8 working days => demand intensity 1.0
      committedStart: '2026-09-01',
      committedFinish: '2026-09-10',
      actualFinish: null,
      dodRef: '',
    });

    const lines = useStore.getState().engine.getProjectLoqDemand(project.id, '2026-09');
    expect(lines.find((l) => l.disciplineId === discipline.id)?.demand).toBe(1);
  });

  it('cascades: deleting a cinematic removes its LOQs and their resource windows', async () => {
    await seedStore();
    const { project, discipline } = seedProjectAndDiscipline();
    const { createCinematic, createLoq, createLoqResource, createPool, createPerson, deleteCinematic } = useStore.getState();
    const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });
    const loq = createLoq({
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type: 'L1',
      status: 'TODO',
      estimateDays: 4,
      committedStart: '2026-09-01',
      committedFinish: '2026-09-10',
      actualFinish: null,
      dodRef: '',
    });
    const pool = createPool({ name: 'Animator', color: '#4f7cff', disciplineId: discipline.id, capacityFte: 0 });
    const person = createPerson({ name: 'Ada Lovelace', poolId: pool.id, capacityFte: 1, active: true, notes: '', team: '', site: '' });
    const resource = createLoqResource({ loqId: loq.id, personId: person.id, startDate: '2026-09-01', finishDate: '2026-09-10', fte: 1 });

    deleteCinematic(cinematic.id);

    expect(useStore.getState().data.loqs.some((l) => l.id === loq.id)).toBe(false);
    expect(useStore.getState().data.loqResources.some((r) => r.id === resource.id)).toBe(false);
  });
});

describe('useStore — recommitLoq', () => {
  it('appends a commitment event, keeps the cached window in sync, and stamps the producer name', async () => {
    await seedStore();
    const { project, discipline } = seedProjectAndDiscipline();
    const { createCinematic, createLoq, recommitLoq } = useStore.getState();
    useUiStore.getState().setProducerName('Alex Martin');
    const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });
    const loq = createLoq({
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type: 'L1',
      status: 'TODO',
      estimateDays: 4,
      committedStart: null,
      committedFinish: null,
      actualFinish: null,
      dodRef: '',
    });

    recommitLoq(loq.id, { committedStart: '2026-09-01', committedFinish: '2026-09-10', reason: 'Initial commitment', comment: '' });

    const updated = useStore.getState().data.loqs.find((l) => l.id === loq.id);
    expect(updated?.committedStart).toBe('2026-09-01');
    expect(updated?.committedFinish).toBe('2026-09-10');

    const events = useStore.getState().data.loqCommitmentEvents.filter((e) => e.loqId === loq.id);
    expect(events).toHaveLength(1);
    expect(events[0].changedBy).toBe('Alex Martin');
    expect(events[0].reason).toBe('Initial commitment');
    expect(events[0].committedFinish).toBe('2026-09-10');

    recommitLoq(loq.id, { committedStart: '2026-09-03', committedFinish: '2026-09-12', reason: 'Slipped 2 days', comment: 'Blocked by review' });

    const afterSecond = useStore.getState().data.loqCommitmentEvents.filter((e) => e.loqId === loq.id);
    expect(afterSecond).toHaveLength(2);
    expect(useStore.getState().data.loqs.find((l) => l.id === loq.id)?.committedFinish).toBe('2026-09-12');
  });

  it('falls back to "Unknown" when no producer name has been set', async () => {
    await seedStore();
    const { project, discipline } = seedProjectAndDiscipline();
    const { createCinematic, createLoq, recommitLoq } = useStore.getState();
    const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });
    const loq = createLoq({
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type: 'L1',
      status: 'TODO',
      estimateDays: 4,
      committedStart: null,
      committedFinish: null,
      actualFinish: null,
      dodRef: '',
    });

    recommitLoq(loq.id, { committedStart: '2026-09-01', committedFinish: '2026-09-10', reason: 'Initial commitment', comment: '' });

    const event = useStore.getState().data.loqCommitmentEvents.find((e) => e.loqId === loq.id);
    expect(event?.changedBy).toBe('Unknown');
  });
});

describe('useStore — LoqResource CRUD', () => {
  it('creates, updates, and deletes a resource window', async () => {
    await seedStore();
    const { project, discipline } = seedProjectAndDiscipline();
    const { createCinematic, createLoq, createPool, createPerson, createLoqResource, updateLoqResource, deleteLoqResource } = useStore.getState();
    const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });
    const loq = createLoq({
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type: 'L1',
      status: 'TODO',
      estimateDays: 4,
      committedStart: '2026-09-01',
      committedFinish: '2026-09-10',
      actualFinish: null,
      dodRef: '',
    });
    const pool = createPool({ name: 'Animator', color: '#4f7cff', disciplineId: discipline.id, capacityFte: 0 });
    const person = createPerson({ name: 'Ada Lovelace', poolId: pool.id, capacityFte: 1, active: true, notes: '', team: '', site: '' });

    const resource = createLoqResource({ loqId: loq.id, personId: person.id, startDate: '2026-09-01', finishDate: '2026-09-10', fte: 0.5 });
    expect(useStore.getState().data.loqResources.find((r) => r.id === resource.id)?.fte).toBe(0.5);

    updateLoqResource({ ...resource, fte: 1 });
    expect(useStore.getState().data.loqResources.find((r) => r.id === resource.id)?.fte).toBe(1);

    deleteLoqResource(resource.id);
    expect(useStore.getState().data.loqResources.some((r) => r.id === resource.id)).toBe(false);
  });
});
