import { describe, expect, it } from 'vitest';
import { computeForecasts, impactedLoqIds } from '../src/engine/loqForecast';
import { loq, loqDependency, varianceEvent } from './fixtures';

const CINE = 'cine-1';
const DISC = 'disc-1';

describe('computeForecasts — no signal', () => {
  it('falls back to the committed baseline, delta 0, no root cause', () => {
    const a = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const forecasts = computeForecasts([a], [], []);
    const fa = forecasts.get(a.id)!;
    expect(fa.source).toBe('committed');
    expect(fa.deltaDays).toBe(0);
    expect(fa.forecastFinish).toBe('2026-09-10');
    expect(fa.rootCauseLoqId).toBeNull();
  });
});

describe('computeForecasts — slack-aware threat propagation (A04)', () => {
  it('propagates a delay past the as-built free float, not double-counted, and attributes root cause', () => {
    const pred = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const succ = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-11', committedFinish: '2026-09-20' });
    const dep = loqDependency({ predecessorLoqId: pred.id, successorLoqId: succ.id });
    const variance = varianceEvent({
      loqId: pred.id,
      committedDateAtDeclaration: '2026-09-10',
      forecastDateAtDeclaration: '2026-09-15',
      deltaDays: 5,
      declaredAt: '2026-09-05T00:00:00.000Z',
    });

    const forecasts = computeForecasts([pred, succ], [dep], [variance]);
    const fp = forecasts.get(pred.id)!;
    const fs = forecasts.get(succ.id)!;

    expect(fp.source).toBe('variance');
    expect(fp.deltaDays).toBe(5);
    expect(fp.rootCauseLoqId).toBe(pred.id);

    // The as-built schedule left 1 day of free float between the predecessor's committed finish
    // (09-10) and the successor's committed start (09-11), so a 5-day slip pushes the successor by 4,
    // not 5 — slack is accounted for (A04). The successor's forecast is a derived threat, never a
    // re-commitment.
    expect(fs.source).toBe('propagated');
    expect(fs.deltaDays).toBe(4);
    expect(fs.forecastStart).toBe('2026-09-15');
    expect(fs.forecastFinish).toBe('2026-09-24');
    expect(fs.rootCauseLoqId).toBe(pred.id);
    expect(fs.opportunityDays).toBe(0);

    expect(impactedLoqIds(pred.id, forecasts)).toEqual([succ.id]);
  });

  it('absorbs a slip that fits entirely inside the successor free float — no shift', () => {
    // Prerequisite due Oct 5, successor planned to start Oct 20 (15 days of float). The prerequisite
    // slips 2 days to Oct 7; the float absorbs it, so the successor forecast does not move.
    const pred = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-10-01', committedFinish: '2026-10-05' });
    const succ = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-10-20', committedFinish: '2026-10-29' });
    const dep = loqDependency({ predecessorLoqId: pred.id, successorLoqId: succ.id });
    const variance = varianceEvent({ loqId: pred.id, forecastDateAtDeclaration: '2026-10-07', deltaDays: 2 });

    const forecasts = computeForecasts([pred, succ], [dep], [variance]);
    const fs = forecasts.get(succ.id)!;
    expect(fs.source).toBe('committed');
    expect(fs.deltaDays).toBe(0);
    expect(fs.forecastFinish).toBe('2026-10-29');
  });

  it('an advance never masks a concurrent delay — the late prerequisite binds', () => {
    // One prerequisite is 5 days late, another 10 days early. The old max-ABS-delta rule would have
    // let the −10 advance dominate and show the successor as "ahead"; the net-pressure rule makes the
    // +5 delay bind, so the successor is forecast late and the advance only yields no opportunity.
    const late = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const early = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const succ = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-11', committedFinish: '2026-09-20' });
    const depLate = loqDependency({ predecessorLoqId: late.id, successorLoqId: succ.id });
    const depEarly = loqDependency({ predecessorLoqId: early.id, successorLoqId: succ.id });
    const vLate = varianceEvent({ loqId: late.id, forecastDateAtDeclaration: '2026-09-15', deltaDays: 5 });
    const vEarly = varianceEvent({ loqId: early.id, forecastDateAtDeclaration: '2026-08-31', deltaDays: -10 });

    const forecasts = computeForecasts([late, early, succ], [depLate, depEarly], [vLate, vEarly]);
    const fs = forecasts.get(succ.id)!;
    expect(fs.source).toBe('propagated');
    expect(fs.deltaDays).toBe(4); // +5 slip − 1 day float; the −10 advance does not reduce it
    expect(fs.forecastFinish).toBe('2026-09-24');
    expect(fs.rootCauseLoqId).toBe(late.id);
    expect(fs.opportunityDays).toBe(0); // the late prerequisite forbids any pull-in
  });
});

describe('computeForecasts — early upstream is an opportunity, never an auto-advance (A04)', () => {
  it('keeps the successor committed forecast and surfaces a potential earliest window', () => {
    const pred = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const succ = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-11', committedFinish: '2026-09-20' });
    const dep = loqDependency({ predecessorLoqId: pred.id, successorLoqId: succ.id });
    const variance = varianceEvent({
      loqId: pred.id,
      committedDateAtDeclaration: '2026-09-10',
      forecastDateAtDeclaration: '2026-09-07',
      deltaDays: -3,
    });

    const forecasts = computeForecasts([pred, succ], [dep], [variance]);
    expect(forecasts.get(pred.id)!.deltaDays).toBe(-3);

    const fs = forecasts.get(succ.id)!;
    // The commitment is NOT pulled in automatically: forecast stays at the committed window, delta 0.
    expect(fs.source).toBe('committed');
    expect(fs.deltaDays).toBe(0);
    expect(fs.forecastFinish).toBe('2026-09-20');
    // …but the possibility is computed and presented: 3-day advance + 1 day of float = pull in 4 days.
    expect(fs.opportunityDays).toBe(4);
    expect(fs.opportunityStart).toBe('2026-09-07');
    expect(fs.opportunityFinish).toBe('2026-09-16');
    expect(fs.opportunityRootCauseLoqId).toBe(pred.id);
  });

  it('reports no opportunity when there is no upstream advance beyond the float', () => {
    const pred = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const succ = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-11', committedFinish: '2026-09-20' });
    const dep = loqDependency({ predecessorLoqId: pred.id, successorLoqId: succ.id });

    const forecasts = computeForecasts([pred, succ], [dep], []);
    const fs = forecasts.get(succ.id)!;
    expect(fs.source).toBe('committed');
    expect(fs.deltaDays).toBe(0);
    expect(fs.opportunityDays).toBe(0);
    expect(fs.opportunityStart).toBeNull();
  });
});

describe('computeForecasts — own variance beats propagation', () => {
  it('uses the successor own variance instead of the inherited upstream delta', () => {
    const pred = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const succ = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-11', committedFinish: '2026-09-20' });
    const dep = loqDependency({ predecessorLoqId: pred.id, successorLoqId: succ.id });
    const predVariance = varianceEvent({ loqId: pred.id, forecastDateAtDeclaration: '2026-09-15', deltaDays: 5 });
    const succVariance = varianceEvent({ loqId: succ.id, forecastDateAtDeclaration: '2026-09-22', deltaDays: 2 });

    const forecasts = computeForecasts([pred, succ], [dep], [predVariance, succVariance]);
    const fs = forecasts.get(succ.id)!;
    expect(fs.source).toBe('variance');
    expect(fs.deltaDays).toBe(2);
    expect(fs.forecastFinish).toBe('2026-09-22');
    // Successor's own variance makes it its own root cause, not an impact of the predecessor.
    expect(fs.rootCauseLoqId).toBe(succ.id);
  });

  it('only the latest declared variance wins, not a sum of all of them', () => {
    const a = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const older = varianceEvent({ loqId: a.id, forecastDateAtDeclaration: '2026-09-12', declaredAt: '2026-09-02T00:00:00.000Z' });
    const newer = varianceEvent({ loqId: a.id, forecastDateAtDeclaration: '2026-09-14', declaredAt: '2026-09-06T00:00:00.000Z' });

    const forecasts = computeForecasts([a], [], [older, newer]);
    const fa = forecasts.get(a.id)!;
    expect(fa.forecastFinish).toBe('2026-09-14');
    expect(fa.deltaDays).toBe(4);
  });
});

describe('computeForecasts — actualFinish', () => {
  it('converges the forecast to the actual date, taking priority over any variance', () => {
    const a = loq({
      cinematicId: CINE,
      disciplineId: DISC,
      committedStart: '2026-09-01',
      committedFinish: '2026-09-10',
      actualFinish: '2026-09-12',
    });
    const variance = varianceEvent({ loqId: a.id, forecastDateAtDeclaration: '2026-09-20' });

    const forecasts = computeForecasts([a], [], [variance]);
    const fa = forecasts.get(a.id)!;
    expect(fa.source).toBe('actual');
    expect(fa.forecastFinish).toBe('2026-09-12');
    expect(fa.deltaDays).toBe(2);
    expect(fa.rootCauseLoqId).toBe(a.id);
  });

  it('reports delta 0 and no root cause when the actual finish matches the committed date', () => {
    const a = loq({ cinematicId: CINE, disciplineId: DISC, committedStart: '2026-09-01', committedFinish: '2026-09-10', actualFinish: '2026-09-10' });
    const forecasts = computeForecasts([a], [], []);
    const fa = forecasts.get(a.id)!;
    expect(fa.deltaDays).toBe(0);
    expect(fa.rootCauseLoqId).toBeNull();
  });
});
