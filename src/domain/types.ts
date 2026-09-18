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
  /** Marks a "dispo"/bench placeholder project — people parked here still count as staffed for warnings. */
  isDispo: boolean;
  /** Baseline (import-matched) name before a rename override — set by applyStructureOverrides, not persisted on this row. */
  importName?: string;
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
  /** Baseline (import-matched) name before a rename override — set by applyStructureOverrides, not persisted on this row. */
  importName?: string;
}

export interface Discipline {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Baseline (import-matched) name before a rename override — set by applyStructureOverrides, not persisted on this row. */
  importName?: string;
}

export interface Person {
  id: string;
  name: string;
  poolId: string | null;
  capacityFte: number;
  active: boolean;
  notes: string;
  sortOrder: number;
  /** Free-text team name, independent of the role/pool hierarchy. */
  team: string;
  /** Free-text studio/location, independent of team. */
  site: string;
  /** Baseline poolId before structure overrides — set by applyStructureOverrides, not persisted on this row. */
  importPoolId?: string | null;
  /** Baseline (import-matched) name before a rename override — set by applyStructureOverrides, not persisted on this row. */
  importName?: string;
  /** Discipline this person is grouped under — their role's discipline, unless a person_discipline
   * override relocates them. Set by applyStructureOverrides, not persisted on this row. */
  effectiveDisciplineId?: string | null;
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

/**
 * Kind of a persistent structure override — see applyStructureOverrides for how each is resolved.
 * The `*_name` kinds are rename overrides: sourceKey is normalizeKey(the frozen, import-matched
 * name), targetKey is the literal (case-preserved) display name — never normalized, since there is
 * no entity to look up, just a label to show.
 */
export type StructureOverrideKind =
  | 'person_pool' | 'pool_discipline' | 'pool_person_pool' | 'person_discipline'
  | 'discipline_name' | 'pool_name' | 'person_name' | 'project_name';

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

// ---------------------------------------------------------------------------
// Cinematic/LOQ model (v7) — see docs/DATA_MODEL.md. Project 1-N Cinematic 1-N LOQ; each LOQ
// carries its own resources/commitment history/variance history/Jira snapshot, plus
// self-referential dependencies materialized from dependency_templates.
// ---------------------------------------------------------------------------

/** Closed 3-value enum — see docs/DATA_MODEL.md §4 ("no percentage-complete field, status is the
 * three-value enum only"). */
export type LoqStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';

/** Free text initially (e.g. "L1", "L2", "Final") — validate against real Jira issue types before
 * constraining to a union, see docs/DATA_MODEL.md and INTEGRATIONS.md. */
export type LoqType = string;

export type DependencySource = 'template' | 'override';

/** Canonical scheduling-relation set; only 'finish_to_start' is currently produced (the DDL
 * default) — the others exist for forward compatibility as dependency modeling matures. */
export type DependencyType = 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';

/** Free text for now — the category set is deferred to PLANNING_ENGINE.md §4.1 (validated as-is,
 * may evolve as the AP team's working vocabulary surfaces). */
export type VarianceCategory = string;

export interface Cinematic {
  id: string;
  projectId: string;
  name: string;
  /** ISO date (yyyy-mm-dd) or null when TBD */
  targetDate: string | null;
  sortOrder: number;
  notes: string;
}

export interface Loq {
  id: string;
  cinematicId: string;
  disciplineId: string;
  /** e.g. "PROD-1234"; null until synced/linked. */
  jiraKey: string | null;
  type: LoqType;
  status: LoqStatus;
  /** Planned effort in days; null when not estimated. */
  estimateDays: number | null;
  /** Denormalized cache of the newest loq_commitment_events row for this LOQ — never edited
   * directly, see LoqCommitmentEvent. ISO date or null (TBD). */
  committedStart: string | null;
  committedFinish: string | null;
  /** ISO date, set only by Jira sync or explicit manual close. */
  actualFinish: string | null;
  dodRef: string;
  sortOrder: number;
}

/** Append-only: the first row for a LOQ is its initial commitment, every later row is an explicit
 * re-commitment. loqs.committedStart/Finish is always the row with the max changedAt. */
export interface LoqCommitmentEvent {
  id: string;
  loqId: string;
  committedStart: string | null;
  committedFinish: string | null;
  changedBy: string;
  /** ISO datetime. */
  changedAt: string;
  reason: string;
  comment: string;
}

export interface LoqResource {
  id: string;
  loqId: string;
  personId: string;
  /** Share of this person's time on this LOQ. */
  fte: number;
}

export interface LoqDependency {
  id: string;
  predecessorLoqId: string;
  successorLoqId: string;
  type: DependencyType;
  lagDays: number;
  source: DependencySource;
  templateId: string | null;
}

export interface DependencyTemplate {
  id: string;
  predecessorDisciplineId: string;
  predecessorLoqType: LoqType;
  successorDisciplineId: string;
  successorLoqType: LoqType;
  type: DependencyType;
  lagDays: number;
}

/** Append-only, never edited or deleted — a correction is a new row. */
export interface VarianceEvent {
  id: string;
  loqId: string;
  category: VarianceCategory;
  comment: string;
  declaredBy: string;
  declaredAt: string;
  committedDateAtDeclaration: string | null;
  forecastDateAtDeclaration: string | null;
  deltaDays: number;
}

/** 1:1 with a LOQ — loqId is the primary key, not a separate id. Kept deliberately separate from
 * Loq itself so the Jira adapter can be swapped/versioned independently. */
export interface JiraSyncState {
  loqId: string;
  /** Raw Jira status string, unmapped. */
  jiraStatus: string | null;
  jiraAssignee: string | null;
  /** Jira's own last-updated timestamp. */
  jiraUpdatedAt: string | null;
  lastSyncedAt: string;
  /** JSON blob of whatever fields the adapter cared about. */
  rawSnapshot: string;
}

/** Full snapshot of persisted data the engine operates on. Pure — no DB or UI concerns. */
export interface PlanningData {
  projects: Project[];
  pools: ResourcePool[];
  disciplines: Discipline[];
  people: Person[];
  scenarios: Scenario[];
  requirements: Requirement[];
  requirementAllocations: RequirementAllocation[];
  personAssignments: PersonAssignment[];
  personAssignmentAllocations: PersonAssignmentAllocation[];
  structureOverrides: StructureOverride[];
  cinematics: Cinematic[];
  loqs: Loq[];
  loqCommitmentEvents: LoqCommitmentEvent[];
  loqResources: LoqResource[];
  loqDependencies: LoqDependency[];
  dependencyTemplates: DependencyTemplate[];
  varianceEvents: VarianceEvent[];
  jiraSyncStates: JiraSyncState[];
}

export function emptyPlanningData(): PlanningData {
  return {
    projects: [],
    pools: [],
    disciplines: [],
    people: [],
    scenarios: [],
    requirements: [],
    requirementAllocations: [],
    personAssignments: [],
    personAssignmentAllocations: [],
    structureOverrides: [],
    cinematics: [],
    loqs: [],
    loqCommitmentEvents: [],
    loqResources: [],
    loqDependencies: [],
    dependencyTemplates: [],
    varianceEvents: [],
    jiraSyncStates: [],
  };
}
