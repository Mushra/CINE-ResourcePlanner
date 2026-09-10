import type {
  Discipline,
  Person,
  PersonAssignment,
  PersonAssignmentAllocation,
  PlanningData,
  Project,
  Requirement,
  RequirementAllocation,
  ResourcePool,
  Scenario,
  StructureOverride,
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

export function discipline(overrides: Partial<Discipline> = {}): Discipline {
  return {
    id: nextId('disc'),
    name: 'Animation',
    color: '#4f7cff',
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
    disciplineId: null,
    ...overrides,
  };
}

export function person(overrides: Partial<Person> = {}): Person {
  return {
    id: nextId('person'),
    name: 'Person',
    poolId: null,
    capacityFte: 1,
    active: true,
    notes: '',
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

export function personAssignment(
  personId: string,
  projectId: string,
  allocationsByPeriod: Record<string, number>,
  scenarioId = 'base',
): { personAssignment: PersonAssignment; allocations: PersonAssignmentAllocation[] } {
  const id = nextId('pasn');
  return {
    personAssignment: { id, personId, projectId, scenarioId },
    allocations: Object.entries(allocationsByPeriod).map(([period, fte]) => ({ personAssignmentId: id, period, fte })),
  };
}

export function planningData(partial: Partial<PlanningData> = {}): PlanningData {
  return {
    projects: partial.projects ?? [],
    pools: partial.pools ?? [],
    poolCapacityOverrides: partial.poolCapacityOverrides ?? [],
    disciplines: partial.disciplines ?? [],
    people: partial.people ?? [],
    scenarios: partial.scenarios ?? [BASE_SCENARIO],
    requirements: partial.requirements ?? [],
    requirementAllocations: partial.requirementAllocations ?? [],
    personAssignments: partial.personAssignments ?? [],
    personAssignmentAllocations: partial.personAssignmentAllocations ?? [],
    structureOverrides: partial.structureOverrides ?? [],
  };
}

export function structureOverride(overrides: Partial<StructureOverride> = {}): StructureOverride {
  return {
    id: nextId('sovr'),
    kind: 'person_pool',
    sourceKey: '',
    targetKey: '',
    ...overrides,
  };
}
