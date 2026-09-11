import type {
  Discipline,
  Person,
  PersonAssignment,
  PersonAssignmentAllocation,
  PlanningData,
  Period,
  Project,
  Requirement,
  RequirementAllocation,
  ResourcePool,
} from '../domain/types';
import { periodRange, periodFromISODate, comparePeriod } from '../domain/periods';

export const UNASSIGNED_DISCIPLINE_ID = '__unassigned__';

export interface ProjectStaffingLine {
  poolId: string;
  poolName: string;
  required: number;
  assigned: number;
  gap: number; // assigned - required; negative = understaffed
}

export interface ProjectStaffing {
  projectId: string;
  period: Period;
  lines: ProjectStaffingLine[];
}

export interface ProjectPersonStaffingLine {
  personAssignmentId: string;
  personId: string;
  personName: string;
  poolId: string | null;
  fte: number;
}

export interface ProjectPersonStaffing {
  projectId: string;
  period: Period;
  lines: ProjectPersonStaffingLine[];
}

/**
 * Pure, DB/UI-free calculation engine over a PlanningData snapshot. All reads are scoped to a
 * single scenario (defaulting to the base scenario) so future what-if scenarios are just a
 * different scenarioId passed to the constructor.
 *
 * Supply hierarchy: Discipline -> ResourcePool (role) -> Person. Demand (requirements) stays
 * pool-level; supply (assignments) is person-level. A pool's capacity is the sum of its active
 * people's capacityFte, falling back to the pool's own (dormant) capacityFte when it has no
 * active people, so empty pools and pre-migration data stay meaningful.
 */
export class PlanningEngine {
  private readonly data: PlanningData;
  readonly scenarioId: string;

  private readonly poolsById: Map<string, ResourcePool>;
  private readonly projectsById: Map<string, Project>;
  private readonly disciplinesById: Map<string, Discipline>;
  private readonly peopleById: Map<string, Person>;
  private readonly peopleByPool: Map<string, Person[]>;
  private readonly personAssignmentsByProject: Map<string, PersonAssignment[]>;
  private readonly personAssignmentsByPerson: Map<string, PersonAssignment[]>;
  private readonly personAllocationsByAssignmentId: Map<string, PersonAssignmentAllocation[]>;
  private readonly requirementsByPool: Map<string, Requirement[]>;
  private readonly requirementsByProject: Map<string, Requirement[]>;
  private readonly requirementAllocationsByRequirementId: Map<string, RequirementAllocation[]>;

  constructor(data: PlanningData, scenarioId?: string) {
    this.data = data;
    this.scenarioId = scenarioId ?? data.scenarios.find((s) => s.isBase)?.id ?? 'base';
    this.poolsById = new Map(data.pools.map((p) => [p.id, p]));
    this.projectsById = new Map(data.projects.map((p) => [p.id, p]));
    this.disciplinesById = new Map(data.disciplines.map((d) => [d.id, d]));
    this.peopleById = new Map(data.people.map((p) => [p.id, p]));

    this.peopleByPool = new Map();
    for (const person of data.people) {
      if (!person.poolId) continue;
      const list = this.peopleByPool.get(person.poolId) ?? [];
      list.push(person);
      this.peopleByPool.set(person.poolId, list);
    }

    this.personAssignmentsByProject = new Map();
    this.personAssignmentsByPerson = new Map();
    for (const pa of data.personAssignments) {
      const projectList = this.personAssignmentsByProject.get(pa.projectId) ?? [];
      projectList.push(pa);
      this.personAssignmentsByProject.set(pa.projectId, projectList);

      const personList = this.personAssignmentsByPerson.get(pa.personId) ?? [];
      personList.push(pa);
      this.personAssignmentsByPerson.set(pa.personId, personList);
    }

    this.personAllocationsByAssignmentId = new Map();
    for (const alloc of data.personAssignmentAllocations) {
      const list = this.personAllocationsByAssignmentId.get(alloc.personAssignmentId) ?? [];
      list.push(alloc);
      this.personAllocationsByAssignmentId.set(alloc.personAssignmentId, list);
    }

    this.requirementsByPool = new Map();
    this.requirementsByProject = new Map();
    for (const req of data.requirements) {
      const poolList = this.requirementsByPool.get(req.poolId) ?? [];
      poolList.push(req);
      this.requirementsByPool.set(req.poolId, poolList);

      const projectList = this.requirementsByProject.get(req.projectId) ?? [];
      projectList.push(req);
      this.requirementsByProject.set(req.projectId, projectList);
    }

    this.requirementAllocationsByRequirementId = new Map();
    for (const alloc of data.requirementAllocations) {
      const list = this.requirementAllocationsByRequirementId.get(alloc.requirementId) ?? [];
      list.push(alloc);
      this.requirementAllocationsByRequirementId.set(alloc.requirementId, list);
    }
  }

  pools(): ResourcePool[] {
    return [...this.data.pools].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  projects(): Project[] {
    return [...this.data.projects].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  pool(poolId: string): ResourcePool | undefined {
    return this.poolsById.get(poolId);
  }

  project(projectId: string): Project | undefined {
    return this.projectsById.get(projectId);
  }

  disciplines(): Discipline[] {
    return [...this.data.disciplines].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  discipline(disciplineId: string): Discipline | undefined {
    return this.disciplinesById.get(disciplineId);
  }

  people(): Person[] {
    return [...this.data.people].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  person(personId: string): Person | undefined {
    return this.peopleById.get(personId);
  }

  peopleInPool(poolId: string): Person[] {
    return [...(this.peopleByPool.get(poolId) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** Pools belonging to a discipline. Pass UNASSIGNED_DISCIPLINE_ID for pools with no discipline. */
  poolsInDiscipline(disciplineId: string): ResourcePool[] {
    const wantsUnassigned = disciplineId === UNASSIGNED_DISCIPLINE_ID;
    return this.pools().filter((p) => (wantsUnassigned ? p.disciplineId === null : p.disciplineId === disciplineId));
  }

  /** People grouped under a discipline for display — follows each person's effectiveDisciplineId,
   * so a person_discipline override relocates them here even though their role stays elsewhere. */
  peopleInDiscipline(disciplineId: string): Person[] {
    const wantsUnassigned = disciplineId === UNASSIGNED_DISCIPLINE_ID;
    return this.people().filter((person) => (wantsUnassigned ? person.effectiveDisciplineId == null : person.effectiveDisciplineId === disciplineId));
  }

  /** Capacity of a pool for a given period: sum of active people's FTE, or flat capacityFte if empty. */
  getCapacity(poolId: string, _period: Period): number {
    const people = (this.peopleByPool.get(poolId) ?? []).filter((p) => p.active);
    if (people.length === 0) return this.poolsById.get(poolId)?.capacityFte ?? 0;
    return round2(people.reduce((sum, p) => sum + p.capacityFte, 0));
  }

  /** Sum of required FTE for a pool at a period, across all projects in this scenario. */
  getRequiredCapacity(poolId: string, period: Period): number {
    let total = 0;
    for (const req of this.requirementsByPool.get(poolId) ?? []) {
      if (req.scenarioId !== this.scenarioId) continue;
      total += this.requirementAllocationAt(req.id, period);
    }
    return round2(total);
  }

  /** Sum of assigned FTE for a pool at a period, across all projects in this scenario. */
  getAssignedCapacity(poolId: string, period: Period): number {
    let total = 0;
    for (const person of this.peopleByPool.get(poolId) ?? []) {
      for (const pa of this.personAssignmentsByPerson.get(person.id) ?? []) {
        if (pa.scenarioId !== this.scenarioId) continue;
        total += this.personAllocationAt(pa.id, period);
      }
    }
    return round2(total);
  }

  /** Spare capacity not yet assigned to any project (can be negative if over-assigned). */
  getAvailableCapacity(poolId: string, period: Period): number {
    return round2(this.getCapacity(poolId, period) - this.getAssignedCapacity(poolId, period));
  }

  /** Total capacity across every pool at a period — the denominator for plan-wide occupancy. */
  getTotalCapacity(period: Period): number {
    return round2(this.data.pools.reduce((sum, p) => sum + this.getCapacity(p.id, period), 0));
  }

  /** Total FTE staffed on real projects (excludes "dispo"/bench placeholders) across every person. */
  getTotalAssignedExcludingDispo(period: Period): number {
    return round2(this.data.people.reduce((sum, p) => sum + this.getPersonAssignedExcludingDispo(p.id, period), 0));
  }

  /** Sum of a project's assigned FTE across all its person assignments at a period. */
  getProjectAssigned(projectId: string, period: Period): number {
    let total = 0;
    for (const pa of this.personAssignmentsByProject.get(projectId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      total += this.personAllocationAt(pa.id, period);
    }
    return round2(total);
  }

  /** capacity - required. Negative means demand exceeds capacity ("over capacity"). */
  getCapacityGap(poolId: string, period: Period): number {
    return round2(this.getCapacity(poolId, period) - this.getRequiredCapacity(poolId, period));
  }

  isOverCapacity(poolId: string, period: Period): boolean {
    return this.getCapacityGap(poolId, period) < -0.001;
  }

  // Discipline capacity/required/assigned stay pool-based, deliberately not following
  // person_discipline overrides — capacity belongs to the role, not a relocated person's display group.
  getDisciplineCapacity(disciplineId: string, period: Period): number {
    return round2(this.poolsInDiscipline(disciplineId).reduce((sum, p) => sum + this.getCapacity(p.id, period), 0));
  }

  getDisciplineRequiredCapacity(disciplineId: string, period: Period): number {
    return round2(this.poolsInDiscipline(disciplineId).reduce((sum, p) => sum + this.getRequiredCapacity(p.id, period), 0));
  }

  getDisciplineAssignedCapacity(disciplineId: string, period: Period): number {
    return round2(this.poolsInDiscipline(disciplineId).reduce((sum, p) => sum + this.getAssignedCapacity(p.id, period), 0));
  }

  /** Sum of a person's assigned FTE across all their project assignments at a period. */
  getPersonAssigned(personId: string, period: Period): number {
    let total = 0;
    for (const pa of this.personAssignmentsByPerson.get(personId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      total += this.personAllocationAt(pa.id, period);
    }
    return round2(total);
  }

  /** Like getPersonAssigned, but a person parked on an isDispo (bench) project doesn't count as assigned — for "who's actually free" views. */
  getPersonAssignedExcludingDispo(personId: string, period: Period): number {
    let total = 0;
    for (const pa of this.personAssignmentsByPerson.get(personId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      if (this.projectsById.get(pa.projectId)?.isDispo) continue;
      total += this.personAllocationAt(pa.id, period);
    }
    return round2(total);
  }

  /** Required vs. assigned FTE per pool for one project at one period. */
  getProjectStaffing(projectId: string, period: Period): ProjectStaffing {
    const pools = new Map<string, ProjectStaffingLine>();

    for (const req of this.requirementsByProject.get(projectId) ?? []) {
      if (req.scenarioId !== this.scenarioId) continue;
      const fte = this.requirementAllocationAt(req.id, period);
      const line = this.lineFor(pools, req.poolId);
      line.required += fte;
    }
    for (const pa of this.personAssignmentsByProject.get(projectId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      const person = this.peopleById.get(pa.personId);
      if (!person || !person.poolId) continue;
      const fte = this.personAllocationAt(pa.id, period);
      const line = this.lineFor(pools, person.poolId);
      line.assigned += fte;
    }

    const lines = [...pools.values()]
      .map((l) => ({ ...l, required: round2(l.required), assigned: round2(l.assigned), gap: round2(l.assigned - l.required) }))
      .sort((a, b) => a.poolName.localeCompare(b.poolName));

    return { projectId, period, lines };
  }

  /** Per-person assigned FTE for one project at one period — drives the ProjectDetail UI. */
  getProjectPersonStaffing(projectId: string, period: Period): ProjectPersonStaffing {
    const lines: ProjectPersonStaffingLine[] = [];
    for (const pa of this.personAssignmentsByProject.get(projectId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      const person = this.peopleById.get(pa.personId);
      const fte = this.personAllocationAt(pa.id, period);
      lines.push({
        personAssignmentId: pa.id,
        personId: pa.personId,
        personName: person?.name ?? pa.personId,
        poolId: person?.poolId ?? null,
        fte,
      });
    }
    lines.sort((a, b) => a.personName.localeCompare(b.personName));
    return { projectId, period, lines };
  }

  /** Distinct people with any FTE on this project at a period — the headcount shown on the Timeline bar. */
  getProjectAssignedHeadcount(projectId: string, period: Period): number {
    let count = 0;
    for (const pa of this.personAssignmentsByProject.get(projectId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      if (this.personAllocationAt(pa.id, period) > 0.001) count += 1;
    }
    return count;
  }

  /** Aggregate staffing across a project's whole lifecycle (or requirement/assignment span if TBD). */
  getProjectStaffingSummary(projectId: string): ProjectStaffingLine[] {
    const periods = this.projectActivePeriods(projectId);
    const totals = new Map<string, ProjectStaffingLine>();
    for (const period of periods) {
      const staffing = this.getProjectStaffing(projectId, period);
      for (const line of staffing.lines) {
        const t = this.lineFor(totals, line.poolId);
        t.required = Math.max(t.required, line.required);
        t.assigned = Math.max(t.assigned, line.assigned);
      }
    }
    return [...totals.values()]
      .map((l) => ({ ...l, gap: round2(l.assigned - l.required) }))
      .sort((a, b) => a.poolName.localeCompare(b.poolName));
  }

  /** All periods touched by a project: its lifecycle, or the union of its allocation periods if TBD. */
  projectActivePeriods(projectId: string): Period[] {
    const project = this.projectsById.get(projectId);
    const startPeriod = project ? periodFromISODate(project.startDate) : null;
    const endPeriod = project ? periodFromISODate(project.endDate) : null;
    if (startPeriod && endPeriod) return periodRange(startPeriod, endPeriod);
    return this.projectAllocatedPeriods(projectId);
  }

  /** Periods where this project actually has requirement/assignment allocations, regardless of its dates. */
  projectAllocatedPeriods(projectId: string): Period[] {
    const periods = new Set<string>();
    for (const req of this.requirementsByProject.get(projectId) ?? []) {
      if (req.scenarioId !== this.scenarioId) continue;
      for (const a of this.requirementAllocationsByRequirementId.get(req.id) ?? []) {
        periods.add(a.period);
      }
    }
    for (const pa of this.personAssignmentsByProject.get(projectId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      for (const a of this.personAllocationsByAssignmentId.get(pa.id) ?? []) {
        periods.add(a.period);
      }
    }
    return [...periods].sort(comparePeriod);
  }

  /** Pool ids this project has a requirement and/or assignment for, in this scenario. */
  projectPoolIds(projectId: string): string[] {
    const ids = new Set<string>();
    for (const req of this.requirementsByProject.get(projectId) ?? []) {
      if (req.scenarioId === this.scenarioId) ids.add(req.poolId);
    }
    for (const pa of this.personAssignmentsByProject.get(projectId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      const person = this.peopleById.get(pa.personId);
      if (person?.poolId) ids.add(person.poolId);
    }
    return [...ids];
  }

  /** Every period referenced anywhere in the plan (project lifecycles + allocations). Sorted. */
  allKnownPeriods(): Period[] {
    const periods = new Set<string>();
    for (const project of this.data.projects) {
      const range = periodRange(periodFromISODate(project.startDate), periodFromISODate(project.endDate));
      range.forEach((p) => periods.add(p));
    }
    for (const a of this.data.requirementAllocations) periods.add(a.period);
    for (const a of this.data.personAssignmentAllocations) periods.add(a.period);
    for (const o of this.data.poolCapacityOverrides) periods.add(o.period);
    return [...periods].sort(comparePeriod);
  }

  private lineFor(map: Map<string, ProjectStaffingLine>, poolId: string): ProjectStaffingLine {
    let line = map.get(poolId);
    if (!line) {
      line = { poolId, poolName: this.poolsById.get(poolId)?.name ?? poolId, required: 0, assigned: 0, gap: 0 };
      map.set(poolId, line);
    }
    return line;
  }

  private requirementAllocationAt(requirementId: string, period: Period): number {
    const rows = this.requirementAllocationsByRequirementId.get(requirementId);
    return rows?.find((a) => a.period === period)?.fte ?? 0;
  }

  private personAllocationAt(personAssignmentId: string, period: Period): number {
    const rows = this.personAllocationsByAssignmentId.get(personAssignmentId);
    return rows?.find((a) => a.period === period)?.fte ?? 0;
  }
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
