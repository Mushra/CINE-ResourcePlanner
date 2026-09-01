import type {
  Assignment,
  AssignmentAllocation,
  PlanningData,
  Project,
  Requirement,
  RequirementAllocation,
  ResourcePool,
  Scenario,
} from '../src/domain/types';

export const BASE_SCENARIO: Scenario = { id: 'base', name: 'Current Plan', isBase: true };

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: nextId('proj'),
    name: 'Project',
    status: 'active',
    startDate: '2026-09-01',
    startCertainty: 'confirmed',
    endDate: '2026-12-31',
    endCertainty: 'confirmed',
    priority: 'medium',
    notes: '',
    sortOrder: 0,
    ...overrides,
  };
}

export function pool(overrides: Partial<ResourcePool> = {}): ResourcePool {
  return {
    id: nextId('pool'),
    name: 'Animation',
    capacityFte: 8,
    color: '#4f7cff',
    sortOrder: 0,
    ...overrides,
  };
}

export function requirement(
  projectId: string,
  poolId: string,
  allocationsByPeriod: Record<string, number>,
  scenarioId = 'base',
): { requirement: Requirement; allocations: RequirementAllocation[] } {
  const id = nextId('req');
  return {
    requirement: { id, projectId, poolId, scenarioId },
    allocations: Object.entries(allocationsByPeriod).map(([period, fte]) => ({ requirementId: id, period, fte })),
  };
}

export function assignment(
  projectId: string,
  poolId: string,
  allocationsByPeriod: Record<string, number>,
  scenarioId = 'base',
): { assignment: Assignment; allocations: AssignmentAllocation[] } {
  const id = nextId('asn');
  return {
    assignment: { id, projectId, poolId, scenarioId },
    allocations: Object.entries(allocationsByPeriod).map(([period, fte]) => ({ assignmentId: id, period, fte })),
  };
}

export function planningData(partial: Partial<PlanningData> = {}): PlanningData {
  return {
    projects: partial.projects ?? [],
    pools: partial.pools ?? [],
    poolCapacityOverrides: partial.poolCapacityOverrides ?? [],
    scenarios: partial.scenarios ?? [BASE_SCENARIO],
    requirements: partial.requirements ?? [],
    requirementAllocations: partial.requirementAllocations ?? [],
    assignments: partial.assignments ?? [],
    assignmentAllocations: partial.assignmentAllocations ?? [],
  };
}
