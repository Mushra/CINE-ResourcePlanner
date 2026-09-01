import { describe, expect, it } from 'vitest';
import { PlanningEngine } from '../src/engine/planning';
import { assignment, planningData, pool, project, requirement } from './fixtures';

describe('PlanningEngine — capacity', () => {
  it('returns flat pool capacity when no override exists', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const engine = new PlanningEngine(planningData({ pools: [animation] }));
    expect(engine.getCapacity(animation.id, '2026-09')).toBe(8);
  });

  it('uses a per-period override when present', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        poolCapacityOverrides: [{ poolId: animation.id, period: '2026-11', capacityFte: 10 }],
      }),
    );
    expect(engine.getCapacity(animation.id, '2026-10')).toBe(8);
    expect(engine.getCapacity(animation.id, '2026-11')).toBe(10);
  });
});

describe('PlanningEngine — required / assigned / available', () => {
  it('sums requirements and assignments per pool per period across projects', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const p1 = project({ name: 'Alpha' });
    const p2 = project({ name: 'Bravo' });

    const r1 = requirement(p1.id, animation.id, { '2026-09': 2, '2026-10': 3 });
    const r2 = requirement(p2.id, animation.id, { '2026-09': 1, '2026-10': 1 });
    const a1 = assignment(p1.id, animation.id, { '2026-09': 2, '2026-10': 2 });
    const a2 = assignment(p2.id, animation.id, { '2026-09': 1, '2026-10': 1 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1, p2],
        requirements: [r1.requirement, r2.requirement],
        requirementAllocations: [...r1.allocations, ...r2.allocations],
        assignments: [a1.assignment, a2.assignment],
        assignmentAllocations: [...a1.allocations, ...a2.allocations],
      }),
    );

    expect(engine.getRequiredCapacity(animation.id, '2026-09')).toBe(3);
    expect(engine.getRequiredCapacity(animation.id, '2026-10')).toBe(4);
    expect(engine.getAssignedCapacity(animation.id, '2026-09')).toBe(3);
    expect(engine.getAssignedCapacity(animation.id, '2026-10')).toBe(3);
    expect(engine.getAvailableCapacity(animation.id, '2026-09')).toBe(5);
    expect(engine.getAvailableCapacity(animation.id, '2026-10')).toBe(5);
  });

  it('returns 0 demand/assignment for a period with no allocation rows', () => {
    const animation = pool({ capacityFte: 8 });
    const engine = new PlanningEngine(planningData({ pools: [animation] }));
    expect(engine.getRequiredCapacity(animation.id, '2026-09')).toBe(0);
    expect(engine.getAssignedCapacity(animation.id, '2026-09')).toBe(0);
    expect(engine.getAvailableCapacity(animation.id, '2026-09')).toBe(8);
  });
});

describe('PlanningEngine — capacity gap / over-capacity detection', () => {
  it('flags over capacity when demand exceeds pool capacity', () => {
    const animation = pool({ capacityFte: 8 });
    const p1 = project();
    const r1 = requirement(p1.id, animation.id, { '2026-11': 9 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    expect(engine.getCapacityGap(animation.id, '2026-11')).toBe(-1);
    expect(engine.isOverCapacity(animation.id, '2026-11')).toBe(true);
  });

  it('does not flag over capacity when demand is within capacity', () => {
    const animation = pool({ capacityFte: 8 });
    const p1 = project();
    const r1 = requirement(p1.id, animation.id, { '2026-11': 7 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    expect(engine.getCapacityGap(animation.id, '2026-11')).toBe(1);
    expect(engine.isOverCapacity(animation.id, '2026-11')).toBe(false);
  });
});

describe('PlanningEngine — project staffing', () => {
  it('reports required, assigned and gap per pool for a project/period', () => {
    const animation = pool({ name: 'Animation' });
    const vfx = pool({ name: 'VFX' });
    const p1 = project({ name: 'Alpha' });

    const r1 = requirement(p1.id, animation.id, { '2026-09': 3 });
    const r2 = requirement(p1.id, vfx.id, { '2026-09': 1 });
    const a1 = assignment(p1.id, animation.id, { '2026-09': 2 });
    const a2 = assignment(p1.id, vfx.id, { '2026-09': 0.5 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation, vfx],
        projects: [p1],
        requirements: [r1.requirement, r2.requirement],
        requirementAllocations: [...r1.allocations, ...r2.allocations],
        assignments: [a1.assignment, a2.assignment],
        assignmentAllocations: [...a1.allocations, ...a2.allocations],
      }),
    );

    const staffing = engine.getProjectStaffing(p1.id, '2026-09');
    const anim = staffing.lines.find((l) => l.poolId === animation.id)!;
    const vfxLine = staffing.lines.find((l) => l.poolId === vfx.id)!;

    expect(anim).toMatchObject({ required: 3, assigned: 2, gap: -1 });
    expect(vfxLine).toMatchObject({ required: 1, assigned: 0.5, gap: -0.5 });
  });

  it('supports allocation that varies month to month', () => {
    const animation = pool();
    const p1 = project();
    const r1 = requirement(p1.id, animation.id, { '2026-09': 1, '2026-10': 2, '2026-11': 3, '2026-12': 1 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    expect(engine.getRequiredCapacity(animation.id, '2026-09')).toBe(1);
    expect(engine.getRequiredCapacity(animation.id, '2026-10')).toBe(2);
    expect(engine.getRequiredCapacity(animation.id, '2026-11')).toBe(3);
    expect(engine.getRequiredCapacity(animation.id, '2026-12')).toBe(1);
  });
});

describe('PlanningEngine — TBD projects', () => {
  it('derives active periods from allocations when a project has no dates', () => {
    const animation = pool();
    const tbdProject = project({ name: 'Delta', startDate: null, endDate: null, startCertainty: 'tbd', endCertainty: 'tbd' });
    const r1 = requirement(tbdProject.id, animation.id, { '2027-01': 1, '2027-02': 1 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [tbdProject],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    expect(engine.projectActivePeriods(tbdProject.id)).toEqual(['2027-01', '2027-02']);
  });

  it('returns an empty active-period list for a fully undated project with no allocations', () => {
    const tbdProject = project({ startDate: null, endDate: null, startCertainty: 'tbd', endCertainty: 'tbd' });
    const engine = new PlanningEngine(planningData({ projects: [tbdProject] }));
    expect(engine.projectActivePeriods(tbdProject.id)).toEqual([]);
  });
});

describe('PlanningEngine — scenario scoping', () => {
  it('ignores requirements/assignments from a different scenario', () => {
    const animation = pool();
    const p1 = project();
    const r1 = requirement(p1.id, animation.id, { '2026-09': 5 }, 'scenario-b');

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    expect(engine.getRequiredCapacity(animation.id, '2026-09')).toBe(0);
  });
});
