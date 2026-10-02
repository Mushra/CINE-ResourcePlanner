import { describe, expect, it } from 'vitest';
import { PlannerDatabase } from '../src/db/database';
import { applyJiraBindings, type ConfirmedJiraBindings } from '../src/db/applyJiraSync';
import { createCinematic, createDiscipline, createLoq, createLoqDependency, createProject, loadPlanningData } from '../src/db/repository';
import type { NormalizedJiraBatch, NormalizedJiraIssue } from '../src/import/jiraSync';

function issue(overrides: Partial<NormalizedJiraIssue> = {}): NormalizedJiraIssue {
  return {
    key: 'PROD-1', summary: '', issueType: 'Task', status: 'In Progress', labels: [], assignee: 'Alice',
    startDate: null, dueDate: '2026-10-01', resolutionDate: null, parentKey: null,
    cinematicName: null, loqTarget: null, scopeValue: null, epicLinkKey: null, linkedIssueKeys: [], issueLinks: [],
    updatedAt: '2026-09-20T00:00:00Z',
    ...overrides,
  };
}

async function seedProject(db: PlannerDatabase, name = 'Movie A') {
  return createProject(db, { name, status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd', priority: 'medium', notes: '', isDispo: false });
}

describe('applyJiraBindings', () => {
  it('links confirmed Cinematic/LOQ bindings and upserts jira_sync_state, without touching status or dates', async () => {
    const db = await PlannerDatabase.createNew();
    const project = await seedProject(db);
    const discipline = createDiscipline(db, { name: 'Animation', color: '#4f7cff' });
    const cine = createCinematic(db, { projectId: project.id, name: 'Seq010', jiraKey: null, targetDate: null, notes: '' });
    const l1 = createLoq(db, {
      cinematicId: cine.id, disciplineId: discipline.id, jiraKey: null, type: 'L1', status: 'TODO',
      estimateDays: 5, committedStart: '2026-09-01', committedFinish: '2026-09-15', actualFinish: null, dodRef: '',
    });

    const epic = issue({ key: 'PROD-100', summary: 'Seq010', status: 'In Progress' });
    const childIssue = issue({ key: 'PROD-101', summary: 'Animation L1', parentKey: 'PROD-100', status: 'Done' });
    const batch: NormalizedJiraBatch = { issues: [epic, childIssue], warnings: [] };
    const confirmed: ConfirmedJiraBindings = { cinematics: { [cine.id]: 'PROD-100' }, loqs: { [l1.id]: 'PROD-101' } };

    const report = applyJiraBindings(db, batch, project.id, confirmed);
    expect(report).toMatchObject({ cinematicsLinked: 1, cinematicsSkippedOtherProject: 0, loqsLinked: 1, loqsSkippedOtherProject: 0, warnings: [] });

    const data = loadPlanningData(db);
    const linkedCine = data.cinematics.find((c) => c.id === cine.id)!;
    const linkedLoq = data.loqs.find((l) => l.id === l1.id)!;
    expect(linkedCine.jiraKey).toBe('PROD-100');
    expect(linkedLoq.jiraKey).toBe('PROD-101');
    // Signal-only: status and committed dates are untouched even though the linked issue is "Done".
    expect(linkedLoq.status).toBe('TODO');
    expect(linkedLoq.committedStart).toBe('2026-09-01');
    expect(linkedLoq.committedFinish).toBe('2026-09-15');

    const syncState = data.jiraSyncStates.find((s) => s.loqId === l1.id)!;
    expect(syncState).toMatchObject({ jiraStatus: 'Done', jiraAssignee: 'Alice' });
    expect(JSON.parse(syncState.rawSnapshot)).toMatchObject({ key: 'PROD-101', dueDate: '2026-10-01' });

    // The linked epic's own status is snapshot into cinematic_jira_sync (Phase 2), signal-only.
    const epicState = data.cinematicJiraSyncStates.find((s) => s.cinematicId === cine.id)!;
    expect(epicState).toMatchObject({ jiraStatus: 'In Progress' });
    expect(JSON.parse(epicState.rawSnapshot)).toMatchObject({ key: 'PROD-100' });
  });

  it('skips + warns when a confirmed binding belongs to a different project, and leaves it untouched', async () => {
    const db = await PlannerDatabase.createNew();
    const projectA = await seedProject(db, 'Movie A');
    const projectB = await seedProject(db, 'Movie B');
    const cineB = createCinematic(db, { projectId: projectB.id, name: 'Seq020', jiraKey: null, targetDate: null, notes: '' });

    const batch: NormalizedJiraBatch = { issues: [issue({ key: 'PROD-200' })], warnings: [] };
    const report = applyJiraBindings(db, batch, projectA.id, { cinematics: { [cineB.id]: 'PROD-200' }, loqs: {} });

    expect(report.cinematicsLinked).toBe(0);
    expect(report.cinematicsSkippedOtherProject).toBe(1);
    expect(report.warnings[0]).toContain('different project');
    const data = loadPlanningData(db);
    expect(data.cinematics.find((c) => c.id === cineB.id)!.jiraKey).toBeNull();
  });

  it('skips + warns on a jiraKey collision with a different row, never reassigning it', async () => {
    const db = await PlannerDatabase.createNew();
    const project = await seedProject(db);
    const cineTaken = createCinematic(db, { projectId: project.id, name: 'Seq010', jiraKey: 'PROD-100', targetDate: null, notes: '' });
    const cineOther = createCinematic(db, { projectId: project.id, name: 'Seq020', jiraKey: null, targetDate: null, notes: '' });

    const batch: NormalizedJiraBatch = { issues: [issue({ key: 'PROD-100' })], warnings: [] };
    const report = applyJiraBindings(db, batch, project.id, { cinematics: { [cineOther.id]: 'PROD-100' }, loqs: {} });

    expect(report.cinematicsLinked).toBe(0);
    expect(report.cinematicsSkippedOtherProject).toBe(1);
    const data = loadPlanningData(db);
    expect(data.cinematics.find((c) => c.id === cineTaken.id)!.jiraKey).toBe('PROD-100');
    expect(data.cinematics.find((c) => c.id === cineOther.id)!.jiraKey).toBeNull();
  });

  it('skips + warns when the confirmed key is not present in the fetched batch', async () => {
    const db = await PlannerDatabase.createNew();
    const project = await seedProject(db);
    const cine = createCinematic(db, { projectId: project.id, name: 'Seq010', jiraKey: null, targetDate: null, notes: '' });

    const report = applyJiraBindings(db, { issues: [], warnings: [] }, project.id, { cinematics: { [cine.id]: 'PROD-999' }, loqs: {} });
    expect(report.cinematicsLinked).toBe(0);
    expect(report.warnings[0]).toContain('not found');
  });

  it('treats a null confirmed value ("don\'t link") as a no-op', async () => {
    const db = await PlannerDatabase.createNew();
    const project = await seedProject(db);
    const cine = createCinematic(db, { projectId: project.id, name: 'Seq010', jiraKey: null, targetDate: null, notes: '' });

    const report = applyJiraBindings(db, { issues: [issue({ key: 'PROD-100' })], warnings: [] }, project.id, { cinematics: { [cine.id]: null }, loqs: {} });
    expect(report.cinematicsLinked).toBe(0);
    expect(report.warnings).toHaveLength(0);
  });

  it('is idempotent when applying the same confirmed binding twice', async () => {
    const db = await PlannerDatabase.createNew();
    const project = await seedProject(db);
    const cine = createCinematic(db, { projectId: project.id, name: 'Seq010', jiraKey: null, targetDate: null, notes: '' });
    const batch: NormalizedJiraBatch = { issues: [issue({ key: 'PROD-100' })], warnings: [] };
    const confirmed: ConfirmedJiraBindings = { cinematics: { [cine.id]: 'PROD-100' }, loqs: {} };

    applyJiraBindings(db, batch, project.id, confirmed);
    const report2 = applyJiraBindings(db, batch, project.id, confirmed);
    expect(report2).toMatchObject({ cinematicsLinked: 1, cinematicsSkippedOtherProject: 0, warnings: [] });
    expect(loadPlanningData(db).cinematics.find((c) => c.id === cine.id)!.jiraKey).toBe('PROD-100');
  });

  it('persists Hotline (by label) and QA-bug (by type) related issues per cinematic — directly and via a sub-task parent', async () => {
    const db = await PlannerDatabase.createNew();
    const project = await seedProject(db);
    const cine = createCinematic(db, { projectId: project.id, name: 'Seq010 Opening', jiraKey: null, targetDate: null, notes: '' });

    const hotlineDirect = issue({ key: 'PROD-200', issueType: 'Task', labels: ['CINE_HOTLINE'], summary: 'Broken shot', cinematicName: 'Seq010 Opening' });
    const bug = issue({ key: 'PROD-201', issueType: 'Bug', summary: 'Flicker', cinematicName: 'Seq010 Opening', status: 'Open' });
    const parentTask = issue({ key: 'PROD-202', issueType: 'Task', cinematicName: 'Seq010 Opening' });
    const hotlineSubtask = issue({ key: 'PROD-203', issueType: 'Sub-task', labels: ['CINE_HOTLINE'], parentKey: 'PROD-202', cinematicName: null, summary: 'Escalation' });
    const unrelated = issue({ key: 'PROD-204', issueType: 'Story', cinematicName: 'Seq010 Opening' });
    const batch: NormalizedJiraBatch = { issues: [hotlineDirect, bug, parentTask, hotlineSubtask, unrelated], warnings: [] };

    const report = applyJiraBindings(db, batch, project.id, { cinematics: {}, loqs: {} });
    expect(report.relatedIssuesLinked).toBe(3);

    const related = loadPlanningData(db).cinematicRelatedIssues.filter((r) => r.cinematicId === cine.id);
    expect(related.map((r) => r.jiraKey).sort()).toEqual(['PROD-200', 'PROD-201', 'PROD-203']);
    expect(related.find((r) => r.jiraKey === 'PROD-200')!.kind).toBe('hotline');
    expect(related.find((r) => r.jiraKey === 'PROD-201')!.kind).toBe('bug');
    expect(related.find((r) => r.jiraKey === 'PROD-203')!.kind).toBe('hotline'); // resolved via parent's Cinematics List

    // Re-running with a shrunk batch replaces the set (no stale rows linger).
    const report2 = applyJiraBindings(db, { issues: [bug], warnings: [] }, project.id, { cinematics: {}, loqs: {} });
    expect(report2.relatedIssuesLinked).toBe(1);
    expect(loadPlanningData(db).cinematicRelatedIssues.filter((r) => r.cinematicId === cine.id).map((r) => r.jiraKey)).toEqual(['PROD-201']);
  });
});

describe('applyJiraBindings — Jira "Blocks" → dependencies (source=jira mirror)', () => {
  const link = (direction: 'inward' | 'outward', key: string) => ({ typeName: 'Blocks', direction, key });

  /** Seeds a project + one cinematic + N LOQs each bound to a jiraKey, returning helpers to resolve
   * dependency rows (loqId pairs) back to the readable jiraKey pairs. */
  async function seedBoundLoqs(db: PlannerDatabase, keys: string[]) {
    const project = await seedProject(db);
    const discipline = createDiscipline(db, { name: 'Animation', color: '#4f7cff' });
    const cine = createCinematic(db, { projectId: project.id, name: 'Seq010', jiraKey: null, targetDate: null, notes: '' });
    const loqByKey = new Map<string, string>(); // jiraKey -> loqId
    for (const key of keys) {
      const loq = createLoq(db, {
        cinematicId: cine.id, disciplineId: discipline.id, jiraKey: key, type: 'L1', status: 'TODO',
        estimateDays: 3, committedStart: null, committedFinish: null, actualFinish: null, dodRef: '',
      });
      loqByKey.set(key, loq.id);
    }
    const keyByLoqId = new Map([...loqByKey].map(([k, id]) => [id, k]));
    const depKeyPairs = () =>
      loadPlanningData(db)
        .loqDependencies.map((d) => ({
          pred: keyByLoqId.get(d.predecessorLoqId) ?? d.predecessorLoqId,
          succ: keyByLoqId.get(d.successorLoqId) ?? d.successorLoqId,
          source: d.source,
          lagDays: d.lagDays,
        }))
        .sort((a, b) => `${a.pred}${a.succ}`.localeCompare(`${b.pred}${b.succ}`));
    return { project, cine, loqByKey, depKeyPairs };
  }

  const noBindings: ConfirmedJiraBindings = { cinematics: {}, loqs: {} };

  it('mirrors outward "blocking" and inward "is blocked by" links into finish_to_start edges, de-duped', async () => {
    const db = await PlannerDatabase.createNew();
    const { project, depKeyPairs } = await seedBoundLoqs(db, ['OVR-1', 'OVR-2', 'OVR-3']);

    const batch: NormalizedJiraBatch = {
      issues: [
        issue({ key: 'OVR-1', issueLinks: [link('outward', 'OVR-2')] }), // OVR-1 blocks OVR-2
        issue({ key: 'OVR-2', issueLinks: [link('inward', 'OVR-1')] }), // same edge seen from the other end
        issue({ key: 'OVR-3', issueLinks: [link('inward', 'OVR-2')] }), // OVR-2 blocks OVR-3
      ],
      warnings: [],
    };
    const report = applyJiraBindings(db, batch, project.id, noBindings);
    expect(report.dependenciesLinked).toBe(2);
    expect(report.dependenciesSkippedCycle).toBe(0);
    expect(depKeyPairs()).toEqual([
      { pred: 'OVR-1', succ: 'OVR-2', source: 'jira', lagDays: 0 },
      { pred: 'OVR-2', succ: 'OVR-3', source: 'jira', lagDays: 0 },
    ]);
  });

  it('full-replaces the source=jira set on re-sync, dropping edges Jira no longer reports', async () => {
    const db = await PlannerDatabase.createNew();
    const { project, depKeyPairs } = await seedBoundLoqs(db, ['OVR-1', 'OVR-2']);

    applyJiraBindings(db, { issues: [issue({ key: 'OVR-1', issueLinks: [link('outward', 'OVR-2')] })], warnings: [] }, project.id, noBindings);
    expect(depKeyPairs()).toHaveLength(1);

    // OVR-1 no longer blocks anything → the mirrored edge is removed.
    const report2 = applyJiraBindings(db, { issues: [issue({ key: 'OVR-1', issueLinks: [] })], warnings: [] }, project.id, noBindings);
    expect(report2.dependenciesLinked).toBe(0);
    expect(depKeyPairs()).toHaveLength(0);
  });

  it('never overwrites a user/override edge with the Jira mirror', async () => {
    const db = await PlannerDatabase.createNew();
    const { project, loqByKey, depKeyPairs } = await seedBoundLoqs(db, ['OVR-1', 'OVR-2']);
    // A manual/MS Project predecessor already exists on the same pair, with a non-zero lag.
    createLoqDependency(db, { predecessorLoqId: loqByKey.get('OVR-1')!, successorLoqId: loqByKey.get('OVR-2')!, type: 'finish_to_start', lagDays: 5, source: 'override', templateId: null });

    const report = applyJiraBindings(db, { issues: [issue({ key: 'OVR-1', issueLinks: [link('outward', 'OVR-2')] })], warnings: [] }, project.id, noBindings);
    expect(report.dependenciesLinked).toBe(0); // skipped — the override wins
    expect(depKeyPairs()).toEqual([{ pred: 'OVR-1', succ: 'OVR-2', source: 'override', lagDays: 5 }]);
  });

  it('skips a Blocks edge whose other end is not a bound LOQ in this project', async () => {
    const db = await PlannerDatabase.createNew();
    const { project, depKeyPairs } = await seedBoundLoqs(db, ['OVR-1']);
    const report = applyJiraBindings(db, { issues: [issue({ key: 'OVR-1', issueLinks: [link('outward', 'OVR-999')] })], warnings: [] }, project.id, noBindings);
    expect(report.dependenciesLinked).toBe(0);
    expect(depKeyPairs()).toHaveLength(0);
  });

  it('skips a Blocks edge that would close a cycle, leaving the existing edge intact', async () => {
    const db = await PlannerDatabase.createNew();
    const { project, loqByKey, depKeyPairs } = await seedBoundLoqs(db, ['OVR-1', 'OVR-2']);
    // Existing override edge OVR-2 → OVR-1; Jira now claims OVR-1 blocks OVR-2 (the reverse) → a cycle.
    createLoqDependency(db, { predecessorLoqId: loqByKey.get('OVR-2')!, successorLoqId: loqByKey.get('OVR-1')!, type: 'finish_to_start', lagDays: 0, source: 'override', templateId: null });

    const report = applyJiraBindings(db, { issues: [issue({ key: 'OVR-1', issueLinks: [link('outward', 'OVR-2')] })], warnings: [] }, project.id, noBindings);
    expect(report.dependenciesSkippedCycle).toBe(1);
    expect(report.dependenciesLinked).toBe(0);
    expect(depKeyPairs()).toEqual([{ pred: 'OVR-2', succ: 'OVR-1', source: 'override', lagDays: 0 }]);
  });
});
