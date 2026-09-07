import { describe, expect, it } from 'vitest';
import { PlanningEngine } from '../src/engine/planning';
import { getSanityChecks } from '../src/engine/validation';
import { person, personAssignment, planningData, pool, project, requirement } from './fixtures';

describe('getSanityChecks — over capacity', () => {
  it('emits a critical check when demand exceeds pool capacity', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const p1 = project({ name: 'Alpha', startDate: '2026-11-01', endDate: '2026-11-30' });
    const r1 = requirement(p1.id, animation.id, { '2026-11': 9 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'over_capacity');
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ severity: 'critical', poolId: animation.id, period: '2026-11' });
  });

  it('does not flag over capacity when demand is within capacity', () => {
    const animation = pool({ capacityFte: 8 });
    const p1 = project({ startDate: '2026-11-01', endDate: '2026-11-30' });
    const r1 = requirement(p1.id, animation.id, { '2026-11': 6 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    expect(getSanityChecks(engine).filter((c) => c.category === 'over_capacity')).toHaveLength(0);
  });
});

describe('getSanityChecks — understaffing', () => {
  it('flags an understaffed project when assigned is below required', () => {
    const vfx = pool({ name: 'VFX', capacityFte: 3 });
    const elena = person({ poolId: vfx.id });
    const p1 = project({ name: 'Alpha', priority: 'medium', startDate: '2026-09-01', endDate: '2026-09-30' });
    const r1 = requirement(p1.id, vfx.id, { '2026-09': 1 });
    const a1 = personAssignment(elena.id, p1.id, { '2026-09': 0.5 });

    const engine = new PlanningEngine(
      planningData({
        pools: [vfx],
        people: [elena],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
        personAssignments: [a1.personAssignment],
        personAssignmentAllocations: a1.allocations,
      }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'understaffed_project');
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('warning');
    expect(checks[0].impact).toContain('0.5');
  });

  it('escalates to critical for high/critical priority projects', () => {
    const vfx = pool({ capacityFte: 3 });
    const elena = person({ poolId: vfx.id });
    const p1 = project({ priority: 'critical', startDate: '2026-09-01', endDate: '2026-09-30' });
    const r1 = requirement(p1.id, vfx.id, { '2026-09': 1 });
    const a1 = personAssignment(elena.id, p1.id, { '2026-09': 0.5 });

    const engine = new PlanningEngine(
      planningData({
        pools: [vfx],
        people: [elena],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
        personAssignments: [a1.personAssignment],
        personAssignmentAllocations: a1.allocations,
      }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'understaffed_project');
    expect(checks[0].severity).toBe('critical');
  });

  it('flags an unstaffed requirement distinctly when there is zero assignment at all', () => {
    const lighting = pool({ name: 'Lighting', capacityFte: 4 });
    const p1 = project({ name: 'Alpha', startDate: '2026-09-01', endDate: '2026-09-30' });
    const r1 = requirement(p1.id, lighting.id, { '2026-09': 1 });

    const engine = new PlanningEngine(
      planningData({
        pools: [lighting],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    const checks = getSanityChecks(engine);
    expect(checks.some((c) => c.category === 'unstaffed_requirement')).toBe(true);
    expect(checks.some((c) => c.category === 'understaffed_project')).toBe(false);
  });

  it('distinguishes spare-capacity-elsewhere from truly insufficient capacity', () => {
    const animation = pool({ name: 'Animation', capacityFte: 8 });
    const alice = person({ poolId: animation.id, capacityFte: 5 });
    const bob = person({ poolId: animation.id, capacityFte: 3 });
    const p1 = project({ name: 'Alpha', startDate: '2026-09-01', endDate: '2026-09-30' });
    const p2 = project({ name: 'Bravo', startDate: '2026-09-01', endDate: '2026-09-30' });

    const r1 = requirement(p1.id, animation.id, { '2026-09': 3 });
    const a1 = personAssignment(alice.id, p1.id, { '2026-09': 2 });
    const r2 = requirement(p2.id, animation.id, { '2026-09': 1 });
    const a2 = personAssignment(bob.id, p2.id, { '2026-09': 1 });

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

    // capacity 8 (5+3 headcount), total assigned 3 -> 5 FTE spare while Alpha is short by 1
    const available = getSanityChecks(engine).filter((c) => c.category === 'available_not_assigned');
    expect(available).toHaveLength(1);
    expect(available[0].projectId).toBe(p1.id);
  });

  it('does not claim spare capacity when the pool itself is fully consumed', () => {
    const animation = pool({ name: 'Animation', capacityFte: 3 });
    const alice = person({ poolId: animation.id, capacityFte: 2 });
    const bob = person({ poolId: animation.id, capacityFte: 1 });
    const p1 = project({ name: 'Alpha', startDate: '2026-09-01', endDate: '2026-09-30' });
    const p2 = project({ name: 'Bravo', startDate: '2026-09-01', endDate: '2026-09-30' });

    const r1 = requirement(p1.id, animation.id, { '2026-09': 3 });
    const a1 = personAssignment(alice.id, p1.id, { '2026-09': 2 });
    const r2 = requirement(p2.id, animation.id, { '2026-09': 1 });
    const a2 = personAssignment(bob.id, p2.id, { '2026-09': 1 });

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

    expect(getSanityChecks(engine).filter((c) => c.category === 'available_not_assigned')).toHaveLength(0);
  });
});

describe('getSanityChecks — dates', () => {
  it('flags a project whose end date precedes its start date', () => {
    const p1 = project({ startDate: '2026-12-01', endDate: '2026-09-01' });
    const engine = new PlanningEngine(planningData({ projects: [p1] }));
    const checks = getSanityChecks(engine).filter((c) => c.category === 'invalid_dates');
    expect(checks.some((c) => c.projectId === p1.id && c.severity === 'critical')).toBe(true);
  });

  it('flags allocations that fall outside the project lifecycle', () => {
    const animation = pool();
    const p1 = project({ startDate: '2026-09-01', endDate: '2026-09-30' });
    const r1 = requirement(p1.id, animation.id, { '2026-09': 1, '2027-03': 1 });

    const engine = new PlanningEngine(
      planningData({
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'invalid_dates');
    expect(checks.some((c) => c.projectId === p1.id)).toBe(true);
  });

  it('treats TBD dates as a warning, not an error', () => {
    const p1 = project({ startDate: null, endDate: null, startCertainty: 'tbd', endCertainty: 'tbd' });
    const engine = new PlanningEngine(planningData({ projects: [p1] }));
    const checks = getSanityChecks(engine).filter((c) => c.category === 'tbd_dates');
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('warning');
  });
});
