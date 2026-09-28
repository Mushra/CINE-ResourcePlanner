import { describe, expect, it } from 'vitest';
import { PlanningEngine } from '../src/engine/planning';
import {
  buildEffectiveStatusMap,
  cinematicStatus,
  deriveLoqHealth,
  isTerminalStatus,
  statusResolverFrom,
} from '../src/engine/watchtower';
import type { LoqForecast } from '../src/engine/loqForecast';
import type { Loq } from '../src/domain/types';
import { cinematic, discipline, jiraConfig, jiraSyncState, loq, planningData, project } from './fixtures';

function forecast(deltaDays: number): LoqForecast {
  return { loqId: '', forecastStart: null, forecastFinish: null, committedFinish: null, deltaDays, source: 'committed', rootCauseLoqId: null };
}

describe('isTerminalStatus', () => {
  it('treats DONE and CUT as terminal, everything else as active', () => {
    expect(isTerminalStatus('DONE')).toBe(true);
    expect(isTerminalStatus('CUT')).toBe(true);
    expect(isTerminalStatus('BLOCKED')).toBe(false);
    expect(isTerminalStatus('IN_PROGRESS')).toBe(false);
    expect(isTerminalStatus('TODO')).toBe(false);
  });
});

describe('deriveLoqHealth', () => {
  it('reads a voluntary pause as the calm on-hold, even when late or blocked', () => {
    expect(deriveLoqHealth(loq({ paused: true }), forecast(30), 'IN_PROGRESS')).toBe('on-hold');
    expect(deriveLoqHealth(loq({ paused: true }), forecast(0), 'BLOCKED')).toBe('on-hold');
  });

  it('reads an involuntary BLOCKED as the worst health', () => {
    expect(deriveLoqHealth(loq({ paused: false }), forecast(0), 'BLOCKED')).toBe('blocked');
  });

  it('never reads CUT as late — a cut LOQ is neutral on-track regardless of slip', () => {
    expect(deriveLoqHealth(loq(), forecast(30), 'CUT')).toBe('on-track');
  });

  it('scores DONE on the delivered delta (late / ahead / on-track)', () => {
    expect(deriveLoqHealth(loq(), forecast(3), 'DONE')).toBe('late');
    expect(deriveLoqHealth(loq(), forecast(-3), 'DONE')).toBe('ahead');
    expect(deriveLoqHealth(loq(), forecast(0), 'DONE')).toBe('on-track');
  });

  it('scores an active LOQ on the forecast delta thresholds', () => {
    expect(deriveLoqHealth(loq(), forecast(5), 'IN_PROGRESS')).toBe('late');
    expect(deriveLoqHealth(loq(), forecast(2), 'IN_PROGRESS')).toBe('at-risk');
    expect(deriveLoqHealth(loq(), forecast(-2), 'IN_PROGRESS')).toBe('ahead');
    expect(deriveLoqHealth(loq(), forecast(0), 'IN_PROGRESS')).toBe('on-track');
  });
});

describe('buildEffectiveStatusMap / statusResolverFrom', () => {
  it('mirrors a bound + synced LOQ onto its mapped Jira status', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'TODO', jiraKey: 'OVR-2' });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'In Progress' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const map = buildEffectiveStatusMap(engine, [jiraConfig({ projectId: p1.id })]);
    expect(map.get(l1.id)).toBe('IN_PROGRESS');
    expect(statusResolverFrom(map)(l1)).toBe('IN_PROGRESS');
  });

  it('marks a bound status the mapping does not cover as the UNMAPPED sentinel, resolving back to loq.status', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'TODO', jiraKey: 'OVR-3' });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'Bespoke State' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const map = buildEffectiveStatusMap(engine, [jiraConfig({ projectId: p1.id })]);
    expect(map.get(l1.id)).toBe('unmapped');
    // The resolver never scores/rolls-up on the sentinel — it falls back to the plan's own status.
    expect(statusResolverFrom(map)(l1)).toBe('TODO');
  });

  it('leaves an unbound LOQ on its own manual status', () => {
    const l1 = loq({ status: 'IN_PROGRESS', jiraKey: null });
    expect(statusResolverFrom(new Map())(l1)).toBe('IN_PROGRESS');
    expect(statusResolverFrom(null)(l1)).toBe('IN_PROGRESS');
  });
});

describe('cinematicStatus priority rollup', () => {
  const animation = discipline({ name: 'Animation' });
  const layout = discipline({ name: 'Layout' });
  const p1 = project({ name: 'Alpha' });
  const cine = cinematic({ projectId: p1.id });

  function rollup(loqs: Loq[]) {
    const disciplineIds = [...new Set(loqs.map((l) => l.disciplineId))];
    return cinematicStatus(cine.id, disciplineIds, loqs);
  }

  it('lets an involuntary BLOCKED LOQ dominate a parallel in-progress one', () => {
    const a = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS' });
    const b = loq({ cinematicId: cine.id, disciplineId: layout.id, status: 'BLOCKED' });
    expect(rollup([a, b])).toBe('BLOCKED');
  });

  it('shows a voluntary pause (ON_HOLD) only when nothing more active is happening', () => {
    const a = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS', paused: true });
    const b = loq({ cinematicId: cine.id, disciplineId: layout.id, status: 'DONE' });
    expect(rollup([a, b])).toBe('ON_HOLD');
  });

  it('rolls up to DONE only when every discipline is finished (CUT never masks a real DONE)', () => {
    const a = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'DONE' });
    const b = loq({ cinematicId: cine.id, disciplineId: layout.id, status: 'CUT' });
    expect(rollup([a, b])).toBe('DONE');
  });

  it('returns null for a Cinematic with no LOQs', () => {
    expect(rollup([])).toBeNull();
  });
});
