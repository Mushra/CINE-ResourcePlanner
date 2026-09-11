import { describe, expect, it } from 'vitest';
import { PlanningEngine, UNASSIGNED_DISCIPLINE_ID } from '../src/engine/planning';
import { discipline, person, personAssignment, planningData, pool, project, requirement } from './fixtures';

describe('PlanningEngine — capacity (headcount-derived)', () => {
  it('sums active people capacityFte for a pool', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const alice = person({ poolId: animation.id, capacityFte: 1 });
    const bob = person({ poolId: animation.id, capacityFte: 1 });
    const engine = new PlanningEngine(planningData({ pools: [animation], people: [alice, bob] }));
    expect(engine.getCapacity(animation.id, '2026-09')).toBe(2);
  });

  it('falls back to the pool flat capacityFte when it has no active people', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const engine = new PlanningEngine(planningData({ pools: [animation] }));
    expect(engine.getCapacity(animation.id, '2026-09')).toBe(8);
  });

  it('excludes inactive people from the capacity sum', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const alice = person({ poolId: animation.id, capacityFte: 1, active: true });
    const bob = person({ poolId: animation.id, capacityFte: 1, active: false });
    const engine = new PlanningEngine(planningData({ pools: [animation], people: [alice, bob] }));
    expect(engine.getCapacity(animation.id, '2026-09')).toBe(1);
  });

  it('ignores pool capacity overrides — dormant since v2', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const alice = person({ poolId: animation.id, capacityFte: 1 });
    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        people: [alice],
        poolCapacityOverrides: [{ poolId: animation.id, period: '2026-11', capacityFte: 10 }],
      }),
    );
    expect(engine.getCapacity(animation.id, '2026-11')).toBe(1);
  });
});

describe('PlanningEngine — required / assigned / available', () => {
  it('sums requirements and person-assignments per pool per period across projects', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const alice = person({ name: 'Alice', poolId: animation.id, capacityFte: 5 });
    const bob = person({ name: 'Bob', poolId: animation.id, capacityFte: 3 });
    const p1 = project({ name: 'Alpha' });
    const p2 = project({ name: 'Bravo' });

    const r1 = requirement(p1.id, animation.id, { '2026-09': 2, '2026-10': 3 });
    const r2 = requirement(p2.id, animation.id, { '2026-09': 1, '2026-10': 1 });
    const a1 = personAssignment(alice.id, p1.id, { '2026-09': 2, '2026-10': 2 });
    const a2 = personAssignment(bob.id, p2.id, { '2026-09': 1, '2026-10': 1 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        people: [alice, bob],
        projects: [p1, p2],
        requirements: [r1.requirement, r2.requirement],
        requirementAllocations: [...r1.allocations, ...r2.allocations],
        personAssignments: [a1.personAssignment, a2.personAssignment],
        personAssignmentAllocations: [...a1.allocations, ...a2.allocations],
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
    const alice = person({ name: 'Alice', poolId: animation.id });
    const elena = person({ name: 'Elena', poolId: vfx.id });
    const p1 = project({ name: 'Alpha' });

    const r1 = requirement(p1.id, animation.id, { '2026-09': 3 });
    const r2 = requirement(p1.id, vfx.id, { '2026-09': 1 });
    const a1 = personAssignment(alice.id, p1.id, { '2026-09': 2 });
    const a2 = personAssignment(elena.id, p1.id, { '2026-09': 0.5 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation, vfx],
        people: [alice, elena],
        projects: [p1],
        requirements: [r1.requirement, r2.requirement],
        requirementAllocations: [...r1.allocations, ...r2.allocations],
        personAssignments: [a1.personAssignment, a2.personAssignment],
        personAssignmentAllocations: [...a1.allocations, ...a2.allocations],
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

  it('reports per-person assigned FTE for a project/period', () => {
    const animation = pool({ name: 'Animation' });
    const alice = person({ name: 'Alice', poolId: animation.id });
    const bob = person({ name: 'Bob', poolId: animation.id });
    const p1 = project({ name: 'Alpha' });

    const a1 = personAssignment(alice.id, p1.id, { '2026-09': 1 });
    const a2 = personAssignment(bob.id, p1.id, { '2026-09': 0.5 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        people: [alice, bob],
        projects: [p1],
        personAssignments: [a1.personAssignment, a2.personAssignment],
        personAssignmentAllocations: [...a1.allocations, ...a2.allocations],
      }),
    );

    const staffing = engine.getProjectPersonStaffing(p1.id, '2026-09');
    expect(staffing.lines).toEqual([
      { personAssignmentId: a1.personAssignment.id, personId: alice.id, personName: 'Alice', poolId: animation.id, fte: 1 },
      { personAssignmentId: a2.personAssignment.id, personId: bob.id, personName: 'Bob', poolId: animation.id, fte: 0.5 },
    ]);
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

describe('PlanningEngine — disciplines & people', () => {
  it('rolls capacity/required/assigned up from pools to their discipline', () => {
    const animDisc = discipline({ name: 'Animation' });
    const animation = pool({ name: 'Animation', disciplineId: animDisc.id });
    const lighting = pool({ name: 'Lighting', disciplineId: animDisc.id });
    const alice = person({ poolId: animation.id, capacityFte: 1 });
    const bob = person({ poolId: lighting.id, capacityFte: 1 });
    const p1 = project();
    const r1 = requirement(p1.id, animation.id, { '2026-09': 1 });
    const a1 = personAssignment(alice.id, p1.id, { '2026-09': 0.5 });

    const engine = new PlanningEngine(
      planningData({
        disciplines: [animDisc],
        pools: [animation, lighting],
        people: [alice, bob],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
        personAssignments: [a1.personAssignment],
        personAssignmentAllocations: a1.allocations,
      }),
    );

    expect(engine.getDisciplineCapacity(animDisc.id, '2026-09')).toBe(2);
    expect(engine.getDisciplineRequiredCapacity(animDisc.id, '2026-09')).toBe(1);
    expect(engine.getDisciplineAssignedCapacity(animDisc.id, '2026-09')).toBe(0.5);
  });

  it('groups pools with no discipline under the unassigned bucket', () => {
    const animation = pool({ name: 'Animation', disciplineId: null, capacityFte: 8 });
    const engine = new PlanningEngine(planningData({ pools: [animation] }));
    expect(engine.poolsInDiscipline(UNASSIGNED_DISCIPLINE_ID)).toEqual([animation]);
    expect(engine.getDisciplineCapacity(UNASSIGNED_DISCIPLINE_ID, '2026-09')).toBe(8);
  });

  it('sums a person\'s assigned FTE across every project they are staffed on', () => {
    const animation = pool();
    const alice = person({ poolId: animation.id });
    const p1 = project({ name: 'Alpha' });
    const p2 = project({ name: 'Bravo' });
    const a1 = personAssignment(alice.id, p1.id, { '2026-09': 0.5 });
    const a2 = personAssignment(alice.id, p2.id, { '2026-09': 0.3 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        people: [alice],
        projects: [p1, p2],
        personAssignments: [a1.personAssignment, a2.personAssignment],
        personAssignmentAllocations: [...a1.allocations, ...a2.allocations],
      }),
    );

    expect(engine.getPersonAssigned(alice.id, '2026-09')).toBe(0.8);
  });
});

describe('PlanningEngine — plan-wide aggregates (Dashboard widgets)', () => {
  it('sums a project\'s assigned FTE across every person staffed on it', () => {
    const animation = pool();
    const alice = person({ poolId: animation.id });
    const bob = person({ poolId: animation.id });
    const p1 = project({ name: 'Alpha' });
    const a1 = personAssignment(alice.id, p1.id, { '2026-09': 0.5 });
    const a2 = personAssignment(bob.id, p1.id, { '2026-09': 0.3 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        people: [alice, bob],
        projects: [p1],
        personAssignments: [a1.personAssignment, a2.personAssignment],
        personAssignmentAllocations: [...a1.allocations, ...a2.allocations],
      }),
    );

    expect(engine.getProjectAssigned(p1.id, '2026-09')).toBe(0.8);
  });

  it('sums capacity across every pool for total plan-wide capacity', () => {
    const animation = pool({ capacityFte: 8 });
    const vfx = pool({ capacityFte: 4 });
    const alice = person({ poolId: animation.id, capacityFte: 2 });
    const engine = new PlanningEngine(planningData({ pools: [animation, vfx], people: [alice] }));
    expect(engine.getTotalCapacity('2026-09')).toBe(6);
  });

  it('sums assigned FTE across every person, excluding assignments to isDispo projects', () => {
    const animation = pool();
    const alice = person({ poolId: animation.id });
    const bob = person({ poolId: animation.id });
    const realProject = project({ name: 'Alpha' });
    const dispoProject = project({ name: 'Bench', isDispo: true });
    const a1 = personAssignment(alice.id, realProject.id, { '2026-09': 0.6 });
    const a2 = personAssignment(bob.id, dispoProject.id, { '2026-09': 1 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        people: [alice, bob],
        projects: [realProject, dispoProject],
        personAssignments: [a1.personAssignment, a2.personAssignment],
        personAssignmentAllocations: [...a1.allocations, ...a2.allocations],
      }),
    );

    expect(engine.getTotalAssignedExcludingDispo('2026-09')).toBe(0.6);
  });
});
