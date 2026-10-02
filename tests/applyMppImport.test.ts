import { describe, expect, it } from 'vitest';
import { PlannerDatabase } from '../src/db/database';
import { applyMppImport, suggestDisciplineMatches, type MppDisciplineResolution } from '../src/db/applyMppImport';
import { createDiscipline, createLoqResource, createPerson, createProject, loadPlanningData } from '../src/db/repository';
import type { NormalizedMppImport } from '../src/import/mppImport';

function baseImport(overrides: Partial<NormalizedMppImport> = {}): NormalizedMppImport {
  return {
    loqs: [
      { jiraKey: 'OVR-1', cinematicName: 'Exodus Intro', disciplineCode: 'ANIM', type: 'L0', estimateDays: 10, start: '2025-01-06', finish: '2025-01-20' },
      { jiraKey: 'OVR-2', cinematicName: 'Exodus Intro', disciplineCode: 'ANIM', type: 'L1', estimateDays: 5, start: '2025-01-21', finish: '2025-01-27' },
    ],
    dependencies: [{ predecessorJiraKey: 'OVR-1', successorJiraKey: 'OVR-2', type: 'finish_to_start', lagDays: 0 }],
    resources: [{ jiraKey: 'OVR-1', personName: 'Antony Cartot', personGroup: 'ANIM', start: '2025-01-06', finish: '2025-01-20', fte: 1 }],
    roster: [{ name: 'Antony Cartot', group: 'ANIM' }],
    report: {
      totalNonSummaryTasks: 2, importedLoqs: 2, skippedNoJiraKey: 0, skippedMissingDiscipline: 0,
      disciplineCodes: ['ANIM'], warnings: [],
    },
    ...overrides,
  };
}

const AUTO_CREATE_ANIM: Record<string, MppDisciplineResolution> = { ANIM: { kind: 'new', name: 'Animation', color: '#4f7cff' } };

describe('applyMppImport', () => {
  it('creates cinematics/LOQs/dependencies/resources/people scoped to the target project', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });

    const report = applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);

    expect(report.disciplinesCreated).toBe(1);
    expect(report.cinematicsCreated).toBe(1);
    expect(report.loqsCreated).toBe(2);
    expect(report.dependenciesCreated).toBe(1);
    expect(report.peopleCreated).toBe(1);
    expect(report.resourcesLinked).toBe(1);

    const data = loadPlanningData(db);
    expect(data.cinematics).toHaveLength(1);
    expect(data.cinematics[0]).toMatchObject({ projectId: project.id, name: 'Exodus Intro' });
    const loq1 = data.loqs.find((l) => l.jiraKey === 'OVR-1')!;
    const loq2 = data.loqs.find((l) => l.jiraKey === 'OVR-2')!;
    expect(loq1.committedStart).toBe('2025-01-06');
    expect(loq2.estimateDays).toBe(5);
    expect(data.loqDependencies).toHaveLength(1);
    expect(data.loqDependencies[0]).toMatchObject({ predecessorLoqId: loq1.id, successorLoqId: loq2.id });
    expect(data.people.map((p) => p.name)).toEqual(['Antony Cartot']);
    expect(data.loqResources[0]).toMatchObject({ loqId: loq1.id, fte: 1 });
  });

  it('never touches another project even when a LOQ under it collides on jiraKey', async () => {
    const db = await PlannerDatabase.createNew();
    const projectA = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    const projectB = createProject(db, {
      name: 'Movie B', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    // Seed project B with a LOQ that happens to share a jiraKey with the incoming import.
    applyMppImport(db, baseImport({ loqs: [baseImport().loqs[0]!], dependencies: [], resources: [] }), projectB.id, AUTO_CREATE_ANIM);
    const beforeB = loadPlanningData(db);
    const beforeBSnapshot = JSON.stringify({ cinematics: beforeB.cinematics, loqs: beforeB.loqs });

    const report = applyMppImport(db, baseImport(), projectA.id, AUTO_CREATE_ANIM);

    expect(report.loqsSkippedOtherProject).toBe(1); // OVR-1 collided with project B's row
    expect(report.loqsCreated).toBe(1); // only OVR-2 landed in project A
    expect(report.warnings.some((w) => w.includes('OVR-1'))).toBe(true);

    const afterB = loadPlanningData(db);
    const afterBSnapshot = JSON.stringify({
      cinematics: afterB.cinematics.filter((c) => c.projectId === projectB.id),
      loqs: afterB.loqs.filter((l) => l.jiraKey === 'OVR-1'),
    });
    expect(afterBSnapshot).toBe(beforeBSnapshot);

    const projectALoqs = afterB.loqs.filter((l) => afterB.cinematics.find((c) => c.id === l.cinematicId)?.projectId === projectA.id);
    expect(projectALoqs.map((l) => l.jiraKey)).toEqual(['OVR-2']);
  });

  it('is idempotent on re-import: no duplicate rows, no redundant commitment event when dates are unchanged', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });

    const first = applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);
    const second = applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);
    const third = applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);

    expect(first.resourcesLinked).toBe(1);
    expect(second.loqsCreated).toBe(0);
    expect(second.loqsUpdated).toBe(2);
    expect(second.cinematicsCreated).toBe(0);
    expect(second.dependenciesCreated).toBe(1); // upsert, not a duplicate row
    // The A03 fix: an unchanged re-import touches no assignment rows at all.
    expect(second.resourcesLinked).toBe(0);
    expect(second.resourcesUpdated).toBe(0);
    expect(second.resourcesRemoved).toBe(0);
    expect(third.resourcesLinked).toBe(0);

    const data = loadPlanningData(db);
    expect(data.cinematics).toHaveLength(1);
    expect(data.loqs).toHaveLength(2);
    expect(data.loqDependencies).toHaveLength(1);
    // Three identical imports leave a single assignment at its original load — never doubled/tripled.
    expect(data.loqResources).toHaveLength(1);
    expect(data.loqResources[0]).toMatchObject({ fte: 1, source: 'mpp' });
    const loq1 = data.loqs.find((l) => l.jiraKey === 'OVR-1')!;
    const events = data.loqCommitmentEvents.filter((e) => e.loqId === loq1.id);
    expect(events).toHaveLength(1); // dates unchanged on re-import — no second event appended
  });

  it('reconciles a changed assignment rate in place rather than adding a duplicate window', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);

    const rerate = baseImport();
    rerate.resources[0]!.fte = 0.5; // same person, same window, lower load
    const report = applyMppImport(db, rerate, project.id, AUTO_CREATE_ANIM);

    expect(report.resourcesLinked).toBe(0);
    expect(report.resourcesUpdated).toBe(1);
    const data = loadPlanningData(db);
    expect(data.loqResources).toHaveLength(1);
    expect(data.loqResources[0]).toMatchObject({ fte: 0.5 });
  });

  it('reconciles a moved assignment window in place (date change), keeping a single row', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);

    const moved = baseImport();
    moved.resources[0]!.start = '2025-02-03';
    moved.resources[0]!.finish = '2025-02-14';
    const report = applyMppImport(db, moved, project.id, AUTO_CREATE_ANIM);

    expect(report.resourcesUpdated).toBe(1);
    expect(report.resourcesRemoved).toBe(0);
    const data = loadPlanningData(db);
    expect(data.loqResources).toHaveLength(1);
    expect(data.loqResources[0]).toMatchObject({ startDate: '2025-02-03', finishDate: '2025-02-14' });
  });

  it('removes an import-owned assignment the source no longer lists', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);
    expect(loadPlanningData(db).loqResources).toHaveLength(1);

    const withoutResources = baseImport({ resources: [] }); // same LOQs, assignment dropped upstream
    const report = applyMppImport(db, withoutResources, project.id, AUTO_CREATE_ANIM);

    expect(report.resourcesRemoved).toBe(1);
    expect(loadPlanningData(db).loqResources).toHaveLength(0);
  });

  it('never deletes or overwrites a manually-added assignment on a re-imported LOQ', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);
    const data0 = loadPlanningData(db);
    const loq1 = data0.loqs.find((l) => l.jiraKey === 'OVR-1')!;
    // A planner hand-adds a second person on the same LOQ — default source 'manual'.
    const manualPerson = createPerson(db, { name: 'Manual Hire', poolId: null, capacityFte: 1, active: true, notes: '', team: '', site: '' });
    createLoqResource(db, { loqId: loq1.id, personId: manualPerson.id, startDate: '2025-01-06', finishDate: '2025-01-20', fte: 0.25 });

    // A re-import (even one that drops its own assignment) must leave the manual row untouched.
    applyMppImport(db, baseImport({ resources: [] }), project.id, AUTO_CREATE_ANIM);

    const after = loadPlanningData(db);
    const manualRows = after.loqResources.filter((r) => r.source === 'manual');
    expect(manualRows).toHaveLength(1);
    expect(manualRows[0]).toMatchObject({ personId: manualPerson.id, fte: 0.25 });
  });

  it('preserves two legitimately distinct windows for the same person across a re-import', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    const twoWindows = baseImport({
      resources: [
        { jiraKey: 'OVR-1', personName: 'Antony Cartot', personGroup: 'ANIM', start: '2025-01-06', finish: '2025-01-20', fte: 1 },
        { jiraKey: 'OVR-1', personName: 'Antony Cartot', personGroup: 'ANIM', start: '2025-03-03', finish: '2025-03-14', fte: 0.5 },
      ],
    });
    applyMppImport(db, twoWindows, project.id, AUTO_CREATE_ANIM);
    expect(loadPlanningData(db).loqResources).toHaveLength(2);

    const second = applyMppImport(db, twoWindows, project.id, AUTO_CREATE_ANIM);
    expect(second.resourcesLinked).toBe(0);
    expect(second.resourcesRemoved).toBe(0);
    expect(loadPlanningData(db).loqResources).toHaveLength(2); // both disjoint windows kept, not merged
  });

  it('appends a new commitment event when the re-imported dates changed', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);

    const shifted = baseImport();
    shifted.loqs[0]!.start = '2025-01-08';
    shifted.loqs[0]!.finish = '2025-01-22';
    applyMppImport(db, shifted, project.id, AUTO_CREATE_ANIM);

    const data = loadPlanningData(db);
    const loq1 = data.loqs.find((l) => l.jiraKey === 'OVR-1')!;
    expect(loq1.committedStart).toBe('2025-01-08');
    const events = data.loqCommitmentEvents.filter((e) => e.loqId === loq1.id);
    expect(events).toHaveLength(2);
  });

  it('fuzzy-merges a resource into an existing person by name, ignoring case/accents/word order', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    const existingPerson = createPerson(db, { name: 'Cartot Antony', poolId: null, capacityFte: 1, active: true, notes: '', team: '', site: '' });

    const report = applyMppImport(db, baseImport(), project.id, AUTO_CREATE_ANIM);

    expect(report.peopleCreated).toBe(0);
    expect(report.peopleMatched).toBe(1);
    const data = loadPlanningData(db);
    expect(data.people).toHaveLength(1);
    expect(data.loqResources[0]?.personId).toBe(existingPerson.id);
  });

  it('reuses an existing discipline mapped by the caller instead of creating a duplicate', async () => {
    const db = await PlannerDatabase.createNew();
    const project = createProject(db, {
      name: 'Movie A', status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd',
      priority: 'medium', notes: '', isDispo: false,
    });
    const animation = createDiscipline(db, { name: 'Animation', color: '#4f7cff' });

    const report = applyMppImport(db, baseImport(), project.id, { ANIM: { kind: 'existing', id: animation.id } });

    expect(report.disciplinesCreated).toBe(0);
    const data = loadPlanningData(db);
    expect(data.disciplines).toHaveLength(1);
    expect(data.loqs.every((l) => l.disciplineId === animation.id)).toBe(true);
  });
});

describe('suggestDisciplineMatches', () => {
  it('auto-matches a code to an existing discipline by normalized name', () => {
    const animation = { id: 'd1', name: 'Animation', color: '#4f7cff', sortOrder: 0 };
    const suggestions = suggestDisciplineMatches(['ANIMATION', 'VFX'], [animation]);
    expect(suggestions.ANIMATION).toEqual({ kind: 'existing', id: 'd1' });
    expect(suggestions.VFX).toBeUndefined();
  });
});
