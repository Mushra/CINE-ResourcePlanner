// Core domain model. Hierarchy: Discipline -> ResourcePool (role) -> Person.
// Requirements (demand) stay pool-level; assignments (supply) are person-level.
// Time resolution is monthly today; every allocation is keyed by a Period string
// ("YYYY-MM") so weekly resolution can be introduced later without changing shapes.

export type Period = string; // "YYYY-MM"

export type DateCertainty = 'confirmed' | 'estimated' | 'tbd';

export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export type Severity = 'info' | 'warning' | 'critical';

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  /** ISO date (yyyy-mm-dd) or null when TBD */
  startDate: string | null;
  startCertainty: DateCertainty;
  /** ISO date (yyyy-mm-dd) or null when TBD */
  endDate: string | null;
  endCertainty: DateCertainty;
  priority: Priority;
  notes: string;
  sortOrder: number;
}

export interface ResourcePool {
  id: string;
  name: string;
  /** Flat monthly capacity in FTE. Dormant since v2 — capacity now derives from headcount. */
  capacityFte: number;
  color: string;
  sortOrder: number;
  disciplineId: string | null;
  /** Baseline disciplineId before structure overrides — set by applyStructureOverrides, not persisted on this row. */
  importDisciplineId?: string | null;
}

export interface Discipline {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface Person {
  id: string;
  name: string;
  poolId: string | null;
  capacityFte: number;
  active: boolean;
  notes: string;
  sortOrder: number;
  /** Baseline poolId before structure overrides — set by applyStructureOverrides, not persisted on this row. */
  importPoolId?: string | null;
}

/** Lets a pool's capacity vary over time (e.g. a hire lands in November). */
export interface PoolCapacityOverride {
  poolId: string;
  period: Period;
  capacityFte: number;
}

/** Scenario scaffolding for future "what-if" planning. V1 only ever uses the base scenario. */
export interface Scenario {
  id: string;
  name: string;
  isBase: boolean;
}

export interface Requirement {
  id: string;
  projectId: string;
  poolId: string;
  scenarioId: string;
}

export interface RequirementAllocation {
  requirementId: string;
  period: Period;
  fte: number;
}

export interface PersonAssignment {
  id: string;
  personId: string;
  projectId: string;
  scenarioId: string;
}

export interface PersonAssignmentAllocation {
  personAssignmentId: string;
  period: Period;
  fte: number;
}

/** Kind of a persistent structure override — see applyStructureOverrides for how each is resolved. */
export type StructureOverrideKind = 'person_pool' | 'pool_discipline' | 'pool_person_pool';

/**
 * A name-keyed override that lets the Structure view reshape the team without touching the
 * imported baseline. `sourceKey`/`targetKey` are normalizeKey(name) values, so overrides re-apply
 * automatically after a re-import that matches rows by name.
 */
export interface StructureOverride {
  id: string;
  kind: StructureOverrideKind;
  sourceKey: string;
  targetKey: string;
}

/** Full snapshot of persisted data the engine operates on. Pure — no DB or UI concerns. */
export interface PlanningData {
  projects: Project[];
  pools: ResourcePool[];
  poolCapacityOverrides: PoolCapacityOverride[];
  disciplines: Discipline[];
  people: Person[];
  scenarios: Scenario[];
  requirements: Requirement[];
  requirementAllocations: RequirementAllocation[];
  personAssignments: PersonAssignment[];
  personAssignmentAllocations: PersonAssignmentAllocation[];
  structureOverrides: StructureOverride[];
}

export function emptyPlanningData(): PlanningData {
  return {
    projects: [],
    pools: [],
    poolCapacityOverrides: [],
    disciplines: [],
    people: [],
    scenarios: [],
    requirements: [],
    requirementAllocations: [],
    personAssignments: [],
    personAssignmentAllocations: [],
    structureOverrides: [],
  };
}
