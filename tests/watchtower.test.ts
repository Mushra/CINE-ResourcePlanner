import { describe, expect, it } from 'vitest';
import { PlanningEngine } from '../src/engine/planning';
import {
  buildEffectiveStatusMap,
  cellBlockedLoqs,
  cellHealth,
  cinematicHealth,
  cinematicStatus,
  deriveLoqHealth,
  isTerminalStatus,
  representativeLoq,
  statusResolverFrom,
} from '../src/engine/watchtower';
import type { LoqForecast } from '../src/engine/loqForecast';
import type { Loq } from '../src/domain/types';
import { cinematic, discipline, jiraConfig, jiraSyncState, loq, planningData, project } from './fixtures';

function forecast(deltaDays: number, committedFinish: string | null = null): LoqForecast {
  return {
    loqId: '', forecastStart: null, forecastFinish: null, committedFinish, deltaDays, source: 'committed',
    rootCauseLoqId: null, opportunityStart: null, opportunityFinish: null, opportunityDays: 0, opportunityRootCauseLoqId: null,
  };
}

const NOW = '2026-10-02';

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
  it('A05: a voluntary pause absorbs a soft forecast slip (reads on-hold), but never masks a hard threat', () => {
    // Pause yields to a forecast slip — the hold is the dominant, calming signal there.
    expect(deriveLoqHealth(loq({ paused: true }), forecast(30), 'IN_PROGRESS')).toBe('on-hold');
    // …but an involuntary BLOCKED outranks the pause: a paused-and-blocked LOQ still reads blocked.
    expect(deriveLoqHealth(loq({ paused: true }), forecast(0), 'BLOCKED')).toBe('blocked');
    // …and a breached committed deadline outranks the pause too: a pause can't hide an overdue delivery.
    expect(deriveLoqHealth(loq({ paused: true }), forecast(0, '2026-09-01'), 'IN_PROGRESS', { now: NOW })).toBe('late');
  });

  it('reads an involuntary BLOCKED as the worst health', () => {
    expect(deriveLoqHealth(loq({ paused: false }), forecast(0), 'BLOCKED')).toBe('blocked');
  });

  it('A05: reads an active LOQ past its committed finish as late, even with zero declared variance', () => {
    // committedFinish before the observation date, not terminal → late regardless of a flat (0) forecast.
    expect(deriveLoqHealth(loq(), forecast(0, '2026-09-01'), 'IN_PROGRESS', { now: NOW })).toBe('late');
    // Not yet overdue (deadline is in the future) → stays on-track.
    expect(deriveLoqHealth(loq(), forecast(0, '2026-12-01'), 'IN_PROGRESS', { now: NOW })).toBe('on-track');
  });

  it('A05: a terminal (DONE/CUT) LOQ is never overdue, even past its committed finish', () => {
    expect(deriveLoqHealth(loq(), forecast(0, '2026-09-01'), 'DONE', { now: NOW })).toBe('on-track');
    expect(deriveLoqHealth(loq(), forecast(0, '2026-09-01'), 'CUT', { now: NOW })).toBe('on-track');
  });

  it('A05: reads unconfirmable status as explicit "unknown", not a bare on-track', () => {
    // Active, no slip, no breach, but the current status can't be confirmed (stale/absent Jira sync).
    expect(deriveLoqHealth(loq(), forecast(0), 'IN_PROGRESS', { now: NOW, confidence: 'unknown' })).toBe('unknown');
    // A confirmed (default) status with no variance stays on-track — the absence of a slip asserts nothing on its own.
    expect(deriveLoqHealth(loq(), forecast(0), 'IN_PROGRESS', { now: NOW })).toBe('on-track');
  });

  it('A05: a real slip or lead still outranks "unknown" confidence', () => {
    expect(deriveLoqHealth(loq(), forecast(5), 'IN_PROGRESS', { now: NOW, confidence: 'unknown' })).toBe('late');
    expect(deriveLoqHealth(loq(), forecast(-2), 'IN_PROGRESS', { now: NOW, confidence: 'unknown' })).toBe('ahead');
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

  it('A06: a BLOCKED sibling hidden behind an in-progress representative still rolls up to BLOCKED', () => {
    const rep = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS', committedStart: '2026-10-01' });
    const blocked = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'BLOCKED', committedStart: '2026-11-01' });
    // Same cell: the representative is the in-progress one, yet the block must not be masked.
    expect(representativeLoq([rep, blocked], cine.id, animation.id)?.id).toBe(rep.id);
    expect(cinematicStatus(cine.id, [animation.id], [rep, blocked])).toBe('BLOCKED');
  });

  it('A06: a once-blocked sibling that is now DONE raises no false active block', () => {
    const rep = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS', committedStart: '2026-10-01' });
    const finished = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'DONE', committedStart: '2026-09-01' });
    expect(cinematicStatus(cine.id, [animation.id], [rep, finished])).toBe('IN_PROGRESS');
  });
});

describe('cellBlockedLoqs (A06 masking)', () => {
  const animation = discipline({ name: 'Animation' });
  const cine = cinematic({});

  it('returns involuntarily-blocked siblings, excluding terminal and paused ones', () => {
    const inProgress = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS' });
    const blocked = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'BLOCKED' });
    const blockedDone = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'DONE' });
    const blockedPaused = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'BLOCKED', paused: true });
    const result = cellBlockedLoqs([inProgress, blocked, blockedDone, blockedPaused], cine.id, animation.id);
    expect(result.map((l) => l.id)).toEqual([blocked.id]);
  });

  it('scopes to the given (cinematic, discipline) cell only', () => {
    const other = discipline({ name: 'Layout' });
    const here = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'BLOCKED' });
    const elsewhere = loq({ cinematicId: cine.id, disciplineId: other.id, status: 'BLOCKED' });
    expect(cellBlockedLoqs([here, elsewhere], cine.id, animation.id).map((l) => l.id)).toEqual([here.id]);
  });

  it('honours the effective (Jira-mirrored) status via the resolver', () => {
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS' });
    const resolver = statusResolverFrom(new Map([[l1.id, 'BLOCKED' as const]]));
    expect(cellBlockedLoqs([l1], cine.id, animation.id, resolver).map((l) => l.id)).toEqual([l1.id]);
  });
});

describe('cellHealth / cinematicHealth (A06 masking)', () => {
  const animation = discipline({ name: 'Animation' });
  const cine = cinematic({});
  const forecasts = new Map<string, LoqForecast>();

  it('raises an on-track cell to blocked when a sibling is blocked behind the representative', () => {
    const rep = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS', committedStart: '2026-10-01' });
    const blocked = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'BLOCKED', committedStart: '2026-11-01' });
    expect(deriveLoqHealth(rep, undefined, 'IN_PROGRESS')).toBe('on-track');
    expect(cellHealth([rep, blocked], cine.id, animation.id, forecasts)).toBe('blocked');
    expect(cinematicHealth(cine.id, [animation.id], [rep, blocked], forecasts)).toBe('blocked');
  });

  it('keeps the representative health when no sibling is blocked', () => {
    const rep = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS' });
    expect(cellHealth([rep], cine.id, animation.id, forecasts)).toBe('on-track');
  });

  it('a once-blocked but now DONE sibling does not blacken the cell', () => {
    const rep = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS', committedStart: '2026-10-01' });
    const finished = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'DONE', committedStart: '2026-09-01' });
    expect(cellHealth([rep, finished], cine.id, animation.id, forecasts)).toBe('on-track');
  });

  it('returns null for an empty cell', () => {
    expect(cellHealth([], cine.id, animation.id, forecasts)).toBeNull();
  });
});
