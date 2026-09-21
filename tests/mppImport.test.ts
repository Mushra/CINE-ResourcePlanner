import { describe, expect, it } from 'vitest';
import { personMatchKey } from '../src/domain/identity';
import { parseMppJson } from '../src/import/mppImport';
import type { MppShimOutput, MppTaskJson } from '../src/types/mpp';

// Modeled directly on the real Exodus Intro Anim/Light/VFX chain from java/MppToJson.java's
// validated output (see docs/INTEGRATIONS.md) — cross-discipline predecessors included
// (Light-L1 needs both Light-L0 and Anim-L0; VFX-L0 needs Anim-L0) since that's exactly the case
// that would break naive "only look within one discipline" dependency logic.
function task(overrides: Partial<MppTaskJson>): MppTaskJson {
  return {
    uid: 0,
    name: 'placeholder',
    cinematicName: 'SOLO_ACT1_MQ1010_S000_CIN Exodus Intro',
    discipline: 'ANIM',
    loqType: 'L0',
    jiraKey: 'OVR-00000',
    start: '2025-01-06',
    finish: '2025-01-20',
    durationDays: 10,
    workHours: 80,
    predecessors: [],
    resources: [],
    ...overrides,
  };
}

function buildFixture(): MppShimOutput {
  const tasks: MppTaskJson[] = [
    task({ uid: 1, name: 'Exodus Intro-Anim-L0', jiraKey: 'OVR-62666', resources: [{ name: 'Antony Cartot', group: 'ANIM', start: '2025-01-06', finish: '2025-01-20', units: 100 }] }),
    task({ uid: 2, name: 'Exodus Intro-Anim-L1', jiraKey: 'OVR-62667', predecessors: [{ uid: 1, type: 'FS', lagDays: 0 }] }),
    task({ uid: 3, name: 'Exodus Intro-Light-L0', jiraKey: 'OVR-62670', discipline: 'LIGHT' }),
    task({
      uid: 4,
      name: 'Exodus Intro-Light-L1',
      jiraKey: 'OVR-62671',
      discipline: 'LIGHT',
      predecessors: [{ uid: 3, type: 'FS', lagDays: 0 }, { uid: 1, type: 'FS', lagDays: 0 }],
    }),
    task({ uid: 5, name: 'Exodus Intro-VFX-L0', jiraKey: 'OVR-62680', discipline: 'VFX', predecessors: [{ uid: 1, type: 'FS', lagDays: 2 }] }),
    // Previz-style task: no Text2 (loqType null), type must come from the name suffix.
    task({ uid: 6, name: 'Exodus Intro-Previz-C2', jiraKey: 'OVR-62687', discipline: 'PREPROD', loqType: null, workHours: 0, durationDays: 7 }),
    // Non-summary scaffolding task with no Jira key — must be filtered out entirely.
    task({ uid: 7, name: 'ALPHA milestone', jiraKey: undefined as unknown as string, discipline: null, loqType: null }),
  ];
  // uid=7 has no real jiraKey — simulate the shim's own filter by excluding it, but it still counts
  // toward totalNonSummaryTasks (that's the whole point of the field).
  const included = tasks.filter((t) => t.uid !== 7);
  return { totalNonSummaryTasks: tasks.length, tasks: included, resourceRoster: [{ name: 'Antony Cartot', group: 'ANIM' }] };
}

describe('parseMppJson', () => {
  it('groups tasks into LOQs under the parent-task cinematic name', () => {
    const normalized = parseMppJson(buildFixture(), 'sample.mpp');
    expect(normalized.loqs).toHaveLength(6);
    expect(normalized.loqs.every((l) => l.cinematicName === 'SOLO_ACT1_MQ1010_S000_CIN Exodus Intro')).toBe(true);
  });

  it('reports the skipped non-jira scaffolding task', () => {
    const normalized = parseMppJson(buildFixture());
    expect(normalized.report.totalNonSummaryTasks).toBe(7);
    expect(normalized.report.importedLoqs).toBe(6);
    expect(normalized.report.skippedNoJiraKey).toBe(1);
  });

  it('estimates effort from Work hours when populated (8h/day)', () => {
    const normalized = parseMppJson(buildFixture());
    const l0 = normalized.loqs.find((l) => l.jiraKey === 'OVR-62666')!;
    expect(l0.estimateDays).toBe(10); // 80h / 8h/day
  });

  it('falls back to Duration when Work is zero', () => {
    const normalized = parseMppJson(buildFixture());
    const previz = normalized.loqs.find((l) => l.jiraKey === 'OVR-62687')!;
    expect(previz.estimateDays).toBe(7);
  });

  it('infers the LOQ type from the task name when Text2 is null', () => {
    const normalized = parseMppJson(buildFixture());
    const previz = normalized.loqs.find((l) => l.jiraKey === 'OVR-62687')!;
    expect(previz.type).toBe('C2');
  });

  it('keeps every real dependency edge, including cross-discipline ones', () => {
    const normalized = parseMppJson(buildFixture());
    const bySuccessor = (key: string) => normalized.dependencies.filter((d) => d.successorJiraKey === key);
    expect(bySuccessor('OVR-62667')).toEqual([{ predecessorJiraKey: 'OVR-62666', successorJiraKey: 'OVR-62667', type: 'finish_to_start', lagDays: 0 }]);
    // Light-L1 depends on both Light-L0 and Anim-L0 — the cross-discipline edge must survive.
    const lightL1 = bySuccessor('OVR-62671');
    expect(lightL1).toHaveLength(2);
    expect(lightL1.map((d) => d.predecessorJiraKey).sort()).toEqual(['OVR-62666', 'OVR-62670']);
    // VFX-L0's lag is preserved.
    expect(bySuccessor('OVR-62680')).toEqual([{ predecessorJiraKey: 'OVR-62666', successorJiraKey: 'OVR-62680', type: 'finish_to_start', lagDays: 2 }]);
  });

  it('drops a dependency edge whose predecessor was filtered out (no Jira key)', () => {
    const fixture = buildFixture();
    fixture.tasks[1]!.predecessors = [{ uid: 7, type: 'FS', lagDays: 0 }]; // points at the excluded scaffolding task
    const normalized = parseMppJson(fixture);
    expect(normalized.dependencies.filter((d) => d.successorJiraKey === 'OVR-62667')).toHaveLength(0);
  });

  it('scales assignment units to fte and carries the resource group', () => {
    const normalized = parseMppJson(buildFixture());
    const assignment = normalized.resources.find((r) => r.jiraKey === 'OVR-62666')!;
    expect(assignment).toEqual({ jiraKey: 'OVR-62666', personName: 'Antony Cartot', personGroup: 'ANIM', start: '2025-01-06', finish: '2025-01-20', fte: 1 });
  });

  it('collects distinct discipline codes for the interactive mapping step', () => {
    const normalized = parseMppJson(buildFixture());
    expect(normalized.report.disciplineCodes).toEqual(['ANIM', 'LIGHT', 'PREPROD', 'VFX']);
  });

  it('reports and skips a task with a Jira key but no discipline', () => {
    const fixture = buildFixture();
    fixture.tasks.push(task({ uid: 8, name: 'Orphan', jiraKey: 'OVR-99999', discipline: null }));
    const normalized = parseMppJson(fixture);
    expect(normalized.loqs.some((l) => l.jiraKey === 'OVR-99999')).toBe(false);
    expect(normalized.report.skippedMissingDiscipline).toBe(1);
    expect(normalized.report.warnings.some((w) => w.includes('OVR-99999'))).toBe(true);
  });
});

describe('personMatchKey', () => {
  it('is case-insensitive', () => {
    expect(personMatchKey('Antony Cartot')).toBe(personMatchKey('antony cartot'));
  });

  it('is accent-insensitive', () => {
    expect(personMatchKey('Éric Dupont')).toBe(personMatchKey('Eric Dupont'));
  });

  it('is insensitive to first/last name order', () => {
    expect(personMatchKey('Éric Dupont')).toBe(personMatchKey('Dupont Eric'));
  });

  it('does not collapse genuinely different names', () => {
    expect(personMatchKey('Antony Cartot')).not.toBe(personMatchKey('Antoine Pertuisel'));
  });
});
