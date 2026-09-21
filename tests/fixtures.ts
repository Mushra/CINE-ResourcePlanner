import type {
  Cinematic,
  Discipline,
  Loq,
  LoqDependency,
  LoqResource,
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
  VarianceEvent,
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
    disciplines: partial.disciplines ?? [],
    people: partial.people ?? [],
    scenarios: partial.scenarios ?? [BASE_SCENARIO],
    requirements: partial.requirements ?? [],
    requirementAllocations: partial.requirementAllocations ?? [],
    personAssignments: partial.personAssignments ?? [],
    personAssignmentAllocations: partial.personAssignmentAllocations ?? [],
    structureOverrides: partial.structureOverrides ?? [],
    cinematics: partial.cinematics ?? [],
    loqs: partial.loqs ?? [],
    loqCommitmentEvents: partial.loqCommitmentEvents ?? [],
    loqResources: partial.loqResources ?? [],
    loqDependencies: partial.loqDependencies ?? [],
    dependencyTemplates: partial.dependencyTemplates ?? [],
    varianceEvents: partial.varianceEvents ?? [],
    jiraSyncStates: partial.jiraSyncStates ?? [],
  };
}

export function cinematic(overrides: Partial<Cinematic> = {}): Cinematic {
  return {
    id: nextId('cine'),
    projectId: '',
    name: 'Seq01',
    targetDate: null,
    sortOrder: 0,
    notes: '',
    ...overrides,
  };
}

export function loq(overrides: Partial<Loq> = {}): Loq {
  return {
    id: nextId('loq'),
    cinematicId: '',
    disciplineId: '',
    jiraKey: null,
    type: 'L1',
    status: 'TODO',
    estimateDays: null,
    committedStart: null,
    committedFinish: null,
    actualFinish: null,
    dodRef: '',
    sortOrder: 0,
    ...overrides,
  };
}

export function loqResource(overrides: Partial<LoqResource> = {}): LoqResource {
  return {
    id: nextId('lres'),
    loqId: '',
    personId: '',
    startDate: null,
    finishDate: null,
    fte: 1,
    ...overrides,
  };
}

export function loqDependency(overrides: Partial<LoqDependency> = {}): LoqDependency {
  return {
    id: nextId('ldep'),
    predecessorLoqId: '',
    successorLoqId: '',
    type: 'finish_to_start',
    lagDays: 0,
    source: 'override',
    templateId: null,
    ...overrides,
  };
}

export function varianceEvent(overrides: Partial<VarianceEvent> = {}): VarianceEvent {
  return {
    id: nextId('vevt'),
    loqId: '',
    category: 'TECHNICAL_ISSUE',
    comment: '',
    declaredBy: 'Producer',
    declaredAt: '2026-09-01T00:00:00.000Z',
    committedDateAtDeclaration: null,
    forecastDateAtDeclaration: null,
    deltaDays: 0,
    ...overrides,
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
