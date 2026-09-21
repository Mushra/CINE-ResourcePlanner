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

describe('computeForecasts — variance propagation chain', () => {
  it('propagates the predecessor delta to the successor, not double-counted, and attributes root cause', () => {
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

    expect(fs.source).toBe('propagated');
    expect(fs.deltaDays).toBe(5);
    expect(fs.forecastFinish).toBe('2026-09-25');
    expect(fs.rootCauseLoqId).toBe(pred.id);

    expect(impactedLoqIds(pred.id, forecasts)).toEqual([succ.id]);
  });

  it('an early-completion (negative delta) variance propagates as an opportunity', () => {
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
    expect(fs.source).toBe('propagated');
    expect(fs.deltaDays).toBe(-3);
    expect(fs.forecastFinish).toBe('2026-09-17');
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
