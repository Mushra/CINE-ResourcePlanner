import { describe, expect, it } from 'vitest';
import { PlanningEngine } from '../src/engine/planning';
import { buildJiraToleranceMap, getSanityChecks } from '../src/engine/validation';
import type { JiraProjectConfig, PersonAssignment, PersonAssignmentAllocation, Requirement, RequirementAllocation } from '../src/domain/types';
import {
  cinematic,
  discipline,
  jiraSyncState,
  loq,
  loqDependency,
  person,
  personAssignment,
  planningData,
  pool,
  project,
  requirement,
  varianceEvent,
} from './fixtures';

describe('getSanityChecks — over capacity', () => {
  it('emits a critical check when demand exceeds discipline capacity', () => {
    const animationDiscipline = discipline({ name: 'Animation' });
    const animation = pool({ name: 'Animation', capacityFte: 8, disciplineId: animationDiscipline.id });
    const p1 = project({ name: 'Alpha', startDate: '2026-11-01', endDate: '2026-11-30' });
    const r1 = requirement(p1.id, animation.id, { '2026-11': 9 });

    const engine = new PlanningEngine(
      planningData({
        disciplines: [animationDiscipline],
        pools: [animation],
        projects: [p1],
        requirements: [r1.requirement],
        requirementAllocations: r1.allocations,
      }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'over_capacity');
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ severity: 'critical', disciplineId: animationDiscipline.id, period: '2026-11' });
  });

  it('does not flag over capacity when demand is within capacity', () => {
    const animationDiscipline = discipline({ name: 'Animation' });
    const animation = pool({ capacityFte: 8, disciplineId: animationDiscipline.id });
    const p1 = project({ startDate: '2026-11-01', endDate: '2026-11-30' });
    const r1 = requirement(p1.id, animation.id, { '2026-11': 6 });

    const engine = new PlanningEngine(
      planningData({
        disciplines: [animationDiscipline],
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

describe('getSanityChecks — day-precise intervals (sub-month proration)', () => {
  it('prorates a mid-month assignment start into the understaffed gap, same as the engine getters', () => {
    // Mirrors the product example ("starts on the 12th, not the 1st"): starting on the 12th covers
    // 19 of a 30-day month's days (~0.63 FTE that month), not a full month — capacity_conflict/
    // understaffed checks must reflect that prorated figure, proving they still run through the
    // day-overlap resolver post-Phase 1. September (not the already-past April) keeps the project
    // "active" per deriveProjectStatus, which is what checkProjectStaffing requires to run at all.
    const vfx = pool({ name: 'VFX', capacityFte: 3 });
    const elena = person({ poolId: vfx.id });
    const p1 = project({ name: 'Alpha', startDate: '2026-09-01', endDate: '2026-09-30' });

    const requirementId = 'req-day-precise';
    const req: Requirement = { id: requirementId, projectId: p1.id, poolId: vfx.id, scenarioId: 'base' };
    const reqAlloc: RequirementAllocation = {
      id: 'reqalloc-day-precise', requirementId, startDate: '2026-09-01', finishDate: '2026-09-30', fte: 1,
    };

    const assignmentId = 'pasn-day-precise';
    const asn: PersonAssignment = { id: assignmentId, personId: elena.id, projectId: p1.id, scenarioId: 'base' };
    const asnAlloc: PersonAssignmentAllocation = {
      id: 'pasnalloc-day-precise', personAssignmentId: assignmentId, startDate: '2026-09-12', finishDate: '2026-09-30', fte: 1,
    };

    const engine = new PlanningEngine(
      planningData({
        pools: [vfx],
        people: [elena],
        projects: [p1],
        requirements: [req],
        requirementAllocations: [reqAlloc],
        personAssignments: [asn],
        personAssignmentAllocations: [asnAlloc],
      }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'understaffed_project');
    expect(checks).toHaveLength(1);
    expect(checks[0].period).toBe('2026-09');
    expect(checks[0].impact).toContain('0.37'); // missing ~= 1 - 19/30
    expect(checks[0].impact).toContain('0.63'); // assigned ~= 19/30
  });

  it('does not flag over-allocation for a full-month-equivalent person capacity split across two intervals', () => {
    const vfx = pool({ name: 'VFX', capacityFte: 3 });
    const elena = person({ poolId: vfx.id, capacityFte: 1 });
    const p1 = project({ name: 'Alpha', startDate: '2026-09-01', endDate: '2026-09-30' });
    const p2 = project({ name: 'Bravo', startDate: '2026-09-01', endDate: '2026-09-30' });

    const asn1Id = 'pasn-day-precise-1';
    const asn1: PersonAssignment = { id: asn1Id, personId: elena.id, projectId: p1.id, scenarioId: 'base' };
    const asn1Alloc: PersonAssignmentAllocation = {
      id: 'pasnalloc-day-precise-1', personAssignmentId: asn1Id, startDate: '2026-09-01', finishDate: '2026-09-11', fte: 1,
    };
    const asn2Id = 'pasn-day-precise-2';
    const asn2: PersonAssignment = { id: asn2Id, personId: elena.id, projectId: p2.id, scenarioId: 'base' };
    const asn2Alloc: PersonAssignmentAllocation = {
      id: 'pasnalloc-day-precise-2', personAssignmentId: asn2Id, startDate: '2026-09-12', finishDate: '2026-09-30', fte: 1,
    };

    const engine = new PlanningEngine(
      planningData({
        pools: [vfx],
        people: [elena],
        projects: [p1, p2],
        personAssignments: [asn1, asn2],
        personAssignmentAllocations: [asn1Alloc, asn2Alloc],
      }),
    );

    expect(getSanityChecks(engine).filter((c) => c.category === 'over_allocated_person')).toHaveLength(0);
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

describe('getSanityChecks — cinematic capacity conflict', () => {
  // 2026-09-01 (Tue) .. 2026-09-10 (Thu) = 8 working days, used throughout so estimateDays/8 is a
  // clean intensity.
  const WINDOW = { committedStart: '2026-09-01', committedFinish: '2026-09-10' };

  it('flags LOQ demand that exceeds the project requirement for a discipline/month', () => {
    const animation = discipline({ name: 'Animation' });
    const animationPool = pool({ name: 'Animation', disciplineId: animation.id });
    const p1 = project({ name: 'Alpha', startDate: '2026-09-01', endDate: '2026-09-30' });
    const r1 = requirement(p1.id, animationPool.id, { '2026-09': 0.5 });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, estimateDays: 8, ...WINDOW });

    const engine = new PlanningEngine(
      planningData({
        disciplines: [animation], pools: [animationPool], projects: [p1],
        requirements: [r1.requirement], requirementAllocations: r1.allocations,
        cinematics: [cine], loqs: [l1],
      }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'capacity_conflict_cinematic');
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ severity: 'critical', disciplineId: animation.id, period: '2026-09' });
    expect(checks[0].impact).toContain('1'); // demand 1.0 FTE
    expect(checks[0].impact).toContain('0.5'); // requirement 0.5 FTE
  });

  it('does not flag when demand stays within the requirement', () => {
    const animation = discipline({ name: 'Animation' });
    const animationPool = pool({ name: 'Animation', disciplineId: animation.id });
    const p1 = project({ startDate: '2026-09-01', endDate: '2026-09-30' });
    const r1 = requirement(p1.id, animationPool.id, { '2026-09': 1.5 });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, estimateDays: 8, ...WINDOW });

    const engine = new PlanningEngine(
      planningData({
        disciplines: [animation], pools: [animationPool], projects: [p1],
        requirements: [r1.requirement], requirementAllocations: r1.allocations,
        cinematics: [cine], loqs: [l1],
      }),
    );

    expect(getSanityChecks(engine).filter((c) => c.category === 'capacity_conflict_cinematic')).toHaveLength(0);
  });

  it('still flags a month with LOQ demand but zero requirement coverage', () => {
    const animation = discipline({ name: 'Animation' });
    // TBD project dates + no requirement/assignment at all => projectActivePeriods() is empty; only
    // the LOQ's own demand period brings this month into the check at all.
    const p1 = project({ startDate: null, endDate: null, startCertainty: 'tbd', endCertainty: 'tbd' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, estimateDays: 8, ...WINDOW });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1] }));

    const checks = getSanityChecks(engine).filter((c) => c.category === 'capacity_conflict_cinematic');
    expect(checks).toHaveLength(1);
    expect(checks[0].impact).toContain('requirement 0 FTE');
  });

  it('sums demand across every Cinematic of the project before comparing to the requirement', () => {
    const animation = discipline({ name: 'Animation' });
    const animationPool = pool({ name: 'Animation', disciplineId: animation.id });
    const p1 = project({ startDate: '2026-09-01', endDate: '2026-09-30' });
    const r1 = requirement(p1.id, animationPool.id, { '2026-09': 1 });
    const cineA = cinematic({ projectId: p1.id, name: 'Seq A' });
    const cineB = cinematic({ projectId: p1.id, name: 'Seq B' });
    // 4.8 / 8 working days = 0.6 FTE each; neither alone exceeds the requirement, but 0.6 + 0.6 = 1.2 does.
    const loqA = loq({ cinematicId: cineA.id, disciplineId: animation.id, estimateDays: 4.8, ...WINDOW });
    const loqB = loq({ cinematicId: cineB.id, disciplineId: animation.id, estimateDays: 4.8, ...WINDOW });

    const engine = new PlanningEngine(
      planningData({
        disciplines: [animation], pools: [animationPool], projects: [p1],
        requirements: [r1.requirement], requirementAllocations: r1.allocations,
        cinematics: [cineA, cineB], loqs: [loqA, loqB],
      }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'capacity_conflict_cinematic');
    expect(checks).toHaveLength(1);
    expect(checks[0].impact).toContain('1.2');
  });

  it('skips cancelled projects', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ status: 'cancelled', startDate: '2026-09-01', endDate: '2026-09-30' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, estimateDays: 8, ...WINDOW });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1] }));

    expect(getSanityChecks(engine).filter((c) => c.category === 'capacity_conflict_cinematic')).toHaveLength(0);
  });
});

describe('getSanityChecks — LOQ forecast (at risk, root cause, early opportunity)', () => {
  it('emits loq_at_risk for a LOQ whose forecast has slipped and is not DONE', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id, name: 'Seq01' });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const variance = varianceEvent({ loqId: l1.id, forecastDateAtDeclaration: '2026-09-16', deltaDays: 6 });

    const engine = new PlanningEngine(
      planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], varianceEvents: [variance] }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'loq_at_risk');
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ severity: 'critical', projectId: p1.id, disciplineId: animation.id, loqId: l1.id });
  });

  it('does not flag loq_at_risk once the LOQ is DONE', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'DONE', committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const variance = varianceEvent({ loqId: l1.id, forecastDateAtDeclaration: '2026-09-16', deltaDays: 6 });

    const engine = new PlanningEngine(
      planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], varianceEvents: [variance] }),
    );

    expect(getSanityChecks(engine).filter((c) => c.category === 'loq_at_risk')).toHaveLength(0);
  });

  it('does not flag loq_at_risk (or loq_root_cause/loq_early_opportunity) once the LOQ is paused', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, committedStart: '2026-09-01', committedFinish: '2026-09-10', paused: true });
    const variance = varianceEvent({ loqId: l1.id, forecastDateAtDeclaration: '2026-09-16', deltaDays: 6 });

    const engine = new PlanningEngine(
      planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], varianceEvents: [variance] }),
    );

    const checks = getSanityChecks(engine);
    expect(checks.filter((c) => c.category === 'loq_at_risk')).toHaveLength(0);
    expect(checks.filter((c) => c.category === 'loq_root_cause')).toHaveLength(0);
    expect(checks.filter((c) => c.category === 'loq_early_opportunity')).toHaveLength(0);
  });

  it('emits a single loq_root_cause naming the downstream impact, not a separate check per LOQ', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id, name: 'Seq01' });
    const pred = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L1', committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const succ = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L2', committedStart: '2026-09-11', committedFinish: '2026-09-20' });
    const dep = loqDependency({ predecessorLoqId: pred.id, successorLoqId: succ.id });
    const variance = varianceEvent({ loqId: pred.id, forecastDateAtDeclaration: '2026-09-15', deltaDays: 5 });

    const engine = new PlanningEngine(
      planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [pred, succ], loqDependencies: [dep], varianceEvents: [variance] }),
    );

    const rootCauseChecks = getSanityChecks(engine).filter((c) => c.category === 'loq_root_cause');
    expect(rootCauseChecks).toHaveLength(1);
    expect(rootCauseChecks[0].severity).toBe('critical');
    expect(rootCauseChecks[0].impact).toContain('L2');
    expect(rootCauseChecks[0].loqId).toBe(pred.id);
    expect(rootCauseChecks[0].impacted).toHaveLength(1);
    expect(rootCauseChecks[0].impacted![0]).toMatchObject({ loqId: succ.id });
    expect(rootCauseChecks[0].impacted![0].label).toContain('L2');
    expect(rootCauseChecks[0].impacted![0].deltaDays).toBeGreaterThan(0);

    // The successor is impact-only — it must not get its own loq_root_cause row.
    const atRiskChecks = getSanityChecks(engine).filter((c) => c.category === 'loq_at_risk');
    expect(atRiskChecks).toHaveLength(2);
    expect(atRiskChecks.every((c) => typeof c.loqId === 'string')).toBe(true);
  });

  it('collapses a three-LOQ chain (A -> B -> C) into a single root-cause with two impacted LOQs', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id, name: 'Seq01' });
    const a = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L1', committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const b = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L2', committedStart: '2026-09-11', committedFinish: '2026-09-20' });
    const c = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L3', committedStart: '2026-09-21', committedFinish: '2026-09-30' });
    const depAB = loqDependency({ predecessorLoqId: a.id, successorLoqId: b.id });
    const depBC = loqDependency({ predecessorLoqId: b.id, successorLoqId: c.id });
    const variance = varianceEvent({ loqId: a.id, forecastDateAtDeclaration: '2026-09-15', deltaDays: 5 });

    const engine = new PlanningEngine(
      planningData({
        disciplines: [animation],
        projects: [p1],
        cinematics: [cine],
        loqs: [a, b, c],
        loqDependencies: [depAB, depBC],
        varianceEvents: [variance],
      }),
    );

    const checks = getSanityChecks(engine);
    const rootCauseChecks = checks.filter((chk) => chk.category === 'loq_root_cause');
    expect(rootCauseChecks).toHaveLength(1);
    expect(rootCauseChecks[0].loqId).toBe(a.id);
    expect(rootCauseChecks[0].impacted).toHaveLength(2);
    expect(rootCauseChecks[0].impacted!.map((i) => i.loqId).sort()).toEqual([b.id, c.id].sort());

    const atRiskChecks = checks.filter((chk) => chk.category === 'loq_at_risk');
    expect(atRiskChecks).toHaveLength(3);
  });

  it('emits loq_early_opportunity for an early forecast with a downstream dependent', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const pred = loq({ cinematicId: cine.id, disciplineId: animation.id, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const succ = loq({ cinematicId: cine.id, disciplineId: animation.id, committedStart: '2026-09-11', committedFinish: '2026-09-20' });
    const dep = loqDependency({ predecessorLoqId: pred.id, successorLoqId: succ.id });
    const variance = varianceEvent({ loqId: pred.id, forecastDateAtDeclaration: '2026-09-07', deltaDays: -3 });

    const engine = new PlanningEngine(
      planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [pred, succ], loqDependencies: [dep], varianceEvents: [variance] }),
    );

    const checks = getSanityChecks(engine).filter((c) => c.category === 'loq_early_opportunity');
    expect(checks).toHaveLength(1);
    expect(checks[0].projectId).toBe(p1.id);
  });

  it('does not flag an early forecast when the LOQ has no downstream dependent', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const variance = varianceEvent({ loqId: l1.id, forecastDateAtDeclaration: '2026-09-07', deltaDays: -3 });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], varianceEvents: [variance] }));

    expect(getSanityChecks(engine).filter((c) => c.category === 'loq_early_opportunity')).toHaveLength(0);
  });
});

describe('getSanityChecks — jira_inconsistency', () => {
  it('flags a committed finish beyond tolerance of the Jira due date', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, committedFinish: '2026-09-10' });
    const state = jiraSyncState({ loqId: l1.id, rawSnapshot: JSON.stringify({ dueDate: '2026-09-20' }) });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const checks = getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency' && c.id.includes('finish'));
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('warning');
    expect(checks[0].impact).toContain('10d apart');
  });

  it('does not flag a date delta within the default tolerance', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, committedFinish: '2026-09-10' });
    const state = jiraSyncState({ loqId: l1.id, rawSnapshot: JSON.stringify({ dueDate: '2026-09-11' }) });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    expect(getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency')).toHaveLength(0);
  });

  it('respects a wider per-project tolerance override', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, committedFinish: '2026-09-10' });
    const state = jiraSyncState({ loqId: l1.id, rawSnapshot: JSON.stringify({ dueDate: '2026-09-13' }) });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const withDefaultTolerance = getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency');
    expect(withDefaultTolerance).toHaveLength(1);

    const withWiderTolerance = getSanityChecks(engine, new Map([[p1.id, 5]])).filter((c) => c.category === 'jira_inconsistency');
    expect(withWiderTolerance).toHaveLength(0);
  });

  it('flags planning TODO vs. Jira DONE as critical, without touching status or dates', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'TODO' });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'Done' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const checks = getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency' && c.id.includes('status'));
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('critical');
    expect(l1.status).toBe('TODO'); // the check never mutates the LOQ itself
  });

  it('flags planning IN_PROGRESS vs. Jira TODO as a warning', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS' });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'To Do' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const checks = getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency' && c.id.includes('status'));
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('warning');
  });

  it('surfaces an unrecognized Jira status as its own warning rather than guessing', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'TODO' });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'Some Custom Workflow State' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const checks = getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency');
    expect(checks).toHaveLength(1);
    expect(checks[0].message).toContain('unrecognized');
  });

  it('maps a pause-shaped Jira status (e.g. "Blocked") onto the PAUSED bucket rather than "unrecognized"', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'TODO' });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'Blocked' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const checks = getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency');
    expect(checks).toHaveLength(1);
    expect(checks[0].message).not.toContain('unrecognized');
    expect(checks[0].message).toContain('paused in Jira');
    expect(checks[0].severity).toBe('info');
  });

  it('flags a LOQ that looks paused in Jira but is not marked paused in the plan', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS', paused: false });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'On Hold' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const checks = getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency');
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('info');
    expect(checks[0].message).toContain('looks paused in Jira');
    expect(checks[0].message).toContain('isn\'t marked paused in the plan');
  });

  it('flags a LOQ marked paused in the plan while Jira reports active work', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS', paused: true });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'In Progress' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const checks = getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency');
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('info');
    expect(checks[0].message).toContain('marked paused in the plan');
    expect(checks[0].message).toContain('Jira reports active work');
  });

  it('does not flag a pause mismatch when the LOQ is already marked paused and Jira agrees', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS', paused: true });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'On Hold' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    expect(getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency')).toHaveLength(0);
  });

  it('marks a Jira DONE ahead of the committed finish as an info-level early opportunity, not a warning', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, status: 'IN_PROGRESS', committedFinish: '2026-09-20' });
    const state = jiraSyncState({ loqId: l1.id, jiraStatus: 'Done', rawSnapshot: JSON.stringify({ dueDate: '2026-09-10' }) });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state] }));
    const statusChecks = getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency' && c.id.includes('status'));
    expect(statusChecks).toHaveLength(1);
    expect(statusChecks[0].severity).toBe('info');
  });

  it('emits nothing for a LOQ that has never been synced with Jira', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, committedFinish: '2026-09-10' });

    const engine = new PlanningEngine(planningData({ disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1] }));
    expect(getSanityChecks(engine).filter((c) => c.category === 'jira_inconsistency')).toHaveLength(0);
  });
});

describe('buildJiraToleranceMap', () => {
  function config(overrides: Partial<JiraProjectConfig>): JiraProjectConfig {
    return {
      projectId: 'p1', baseUrl: '', jiraProjectKey: '', authMode: 'server', email: null,
      startDateField: null, dueDateField: null, dateToleranceDays: 1,
      cinematicsListField: null, loqTargetField: null, epicLinkField: null, scopeField: null, scopeValue: null,
      ...overrides,
    };
  }

  it('maps each config\'s projectId to its own dateToleranceDays', () => {
    const map = buildJiraToleranceMap([config({ projectId: 'p1', dateToleranceDays: 3 }), config({ projectId: 'p2', dateToleranceDays: 7 })]);
    expect(map.get('p1')).toBe(3);
    expect(map.get('p2')).toBe(7);
  });

  it('leaves a project with no saved config absent from the map (falls back to DEFAULT_JIRA_TOLERANCE_DAYS at the call site)', () => {
    const map = buildJiraToleranceMap([config({ projectId: 'p1', dateToleranceDays: 3 })]);
    expect(map.has('p2')).toBe(false);
  });

  it('returns an empty map for an empty config list', () => {
    expect(buildJiraToleranceMap([]).size).toBe(0);
  });
});
