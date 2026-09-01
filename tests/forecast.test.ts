import { describe, expect, it } from 'vitest';
import { PlanningEngine } from '../src/engine/planning';
import { getForecast, utilizationStatus } from '../src/engine/forecast';
import { planningData, pool, project, requirement } from './fixtures';
import { todayPeriod } from '../src/domain/periods';

describe('utilizationStatus', () => {
  it('classifies healthy / warning / critical thresholds', () => {
    expect(utilizationStatus(85)).toBe('healthy');
    expect(utilizationStatus(95)).toBe('warning');
    expect(utilizationStatus(110)).toBe('critical');
  });
});

describe('getForecast', () => {
  it('computes utilization percentage per pool per month', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const p1 = project({ startDate: todayPeriod() + '-01', endDate: todayPeriod() + '-01' });
    const r1 = requirement(p1.id, animation.id, { [todayPeriod()]: 4 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    const forecast = getForecast(engine, 3);
    const row = forecast.rows.find((r) => r.poolId === animation.id)!;
    const cell = row.cells.find((c) => c.period === todayPeriod())!;
    expect(cell.utilizationPct).toBe(50);
    expect(cell.status).toBe('healthy');
  });

  it('surfaces a plain-language problem line for over-100% months', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const future = todayPeriod();
    const p1 = project({ startDate: future + '-01', endDate: future + '-01' });
    const r1 = requirement(p1.id, animation.id, { [future]: 9 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    const forecast = getForecast(engine, 3);
    expect(forecast.problems.length).toBeGreaterThan(0);
    expect(forecast.problems[0].message).toContain('Animation');
    expect(forecast.problems[0].overFte).toBe(1);
  });

  it('handles a pool with zero capacity and non-zero demand without throwing', () => {
    const empty = pool({ name: 'Empty', capacityFte: 0 });
    const p1 = project({ startDate: todayPeriod() + '-01', endDate: todayPeriod() + '-01' });
    const r1 = requirement(p1.id, empty.id, { [todayPeriod()]: 1 });

    const engine = new PlanningEngine(
      planningData({
        pools: [empty],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    expect(() => getForecast(engine, 2)).not.toThrow();
  });
});
