import type {
  Cinematic,
  Discipline,
  Loq,
  LoqDependency,
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
import { deriveProjectStatus } from '../domain/projectStatus';
import { getCinematicDisciplineRollup, loqDemandPeriods, type LoqDisciplineRollupLine } from './loqRollup';
import { computeForecasts, type LoqForecast } from './loqForecast';

const EMPTY_LOQ_FORECAST_MAP: ReadonlyMap<string, LoqForecast> = new Map();

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

export interface ProjectDisciplineStaffingLine {
  disciplineId: string;
  disciplineName: string;
  required: number;
  assigned: number;
  gap: number; // assigned - required; negative = understaffed
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

export interface PersonProjectStaffingLine {
  personAssignmentId: string;
  projectId: string;
  projectName: string;
  projectStatus: Project['status'];
  fte: number;
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
  private readonly cinematicsByProject: Map<string, Cinematic[]>;
  private readonly cinematicsById: Map<string, Cinematic>;
  private readonly loqsById: Map<string, Loq>;
  private readonly dependenciesByPredecessor: Map<string, LoqDependency[]>;
  private loqForecastsCache: Map<string, LoqForecast> | null = null;
  private loqForecastsByCinematicCache: Map<string, Map<string, LoqForecast>> | null = null;

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

    this.cinematicsByProject = new Map();
    this.cinematicsById = new Map(data.cinematics.map((c) => [c.id, c]));
    for (const cinematic of data.cinematics) {
      const list = this.cinematicsByProject.get(cinematic.projectId) ?? [];
      list.push(cinematic);
      this.cinematicsByProject.set(cinematic.projectId, list);
    }

    this.loqsById = new Map(data.loqs.map((l) => [l.id, l]));

    this.dependenciesByPredecessor = new Map();
    for (const dep of data.loqDependencies) {
      const list = this.dependenciesByPredecessor.get(dep.predecessorLoqId) ?? [];
      list.push(dep);
      this.dependenciesByPredecessor.set(dep.predecessorLoqId, list);
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

  /** Sum of a project's required FTE across all its requirements at a period — the denominator for per-project occupancy. */
  getProjectRequired(projectId: string, period: Period): number {
    let total = 0;
    for (const req of this.requirementsByProject.get(projectId) ?? []) {
      if (req.scenarioId !== this.scenarioId) continue;
      total += this.requirementAllocationAt(req.id, period);
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

  /**
   * Like getPersonAssigned, but a person parked on an isDispo (bench) project, or on a project
   * that's been manually cancelled, doesn't count as assigned — for "who's actually free" views.
   */
  getPersonAssignedExcludingDispo(personId: string, period: Period): number {
    let total = 0;
    for (const pa of this.personAssignmentsByPerson.get(personId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      const project = this.projectsById.get(pa.projectId);
      if (project?.isDispo || project?.status === 'cancelled') continue;
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

  /**
   * Required vs. assigned FTE per discipline for one project at one period. Needs are stored
   * discipline-only (on a hidden generic pool, see domain/identity.ts) while assignments bucket
   * to each person's specific pool — so need and assigned only reconcile at this granularity.
   * This is the single source of truth for both staffing validation and the merged Besoins/
   * Assignations UI. Pools with no discipline bucket under UNASSIGNED_DISCIPLINE_ID.
   */
  getProjectDisciplineStaffing(projectId: string, period: Period): ProjectDisciplineStaffingLine[] {
    const byDiscipline = new Map<string, ProjectDisciplineStaffingLine>();
    for (const poolLine of this.getProjectStaffing(projectId, period).lines) {
      const disciplineId = this.poolsById.get(poolLine.poolId)?.disciplineId ?? UNASSIGNED_DISCIPLINE_ID;
      let line = byDiscipline.get(disciplineId);
      if (!line) {
        line = {
          disciplineId,
          disciplineName: disciplineId === UNASSIGNED_DISCIPLINE_ID ? 'Unassigned' : (this.disciplinesById.get(disciplineId)?.name ?? disciplineId),
          required: 0,
          assigned: 0,
          gap: 0,
        };
        byDiscipline.set(disciplineId, line);
      }
      line.required += poolLine.required;
      line.assigned += poolLine.assigned;
    }
    return [...byDiscipline.values()]
      .map((l) => ({ ...l, required: round2(l.required), assigned: round2(l.assigned), gap: round2(l.assigned - l.required) }))
      .sort((a, b) => a.disciplineName.localeCompare(b.disciplineName));
  }

  /**
   * Bottom-up LOQ demand per discipline for one project at one period — summed across every
   * Cinematic of the project (Requirement is provisioned per-project, not per-Cinematic, so this is
   * the granularity that actually reconciles against getProjectDisciplineStaffing's `required`). See
   * docs/PLANNING_ENGINE.md §1/§8. `assigned` is carried through for shape parity with
   * LoqDisciplineRollupLine but has no defined project-level meaning yet — only `demand` is consumed
   * by the capacity_conflict_cinematic check.
   */
  getProjectLoqDemand(projectId: string, period: Period): LoqDisciplineRollupLine[] {
    const byDiscipline = new Map<string, LoqDisciplineRollupLine>();
    for (const cinematic of this.cinematicsByProject.get(projectId) ?? []) {
      for (const line of getCinematicDisciplineRollup(cinematic.id, this.data.loqs, this.data.loqResources, this.data.disciplines, period)) {
        const existing = byDiscipline.get(line.disciplineId);
        if (existing) {
          existing.demand += line.demand;
          existing.assigned += line.assigned;
        } else {
          byDiscipline.set(line.disciplineId, { ...line });
        }
      }
    }
    return [...byDiscipline.values()]
      .map((l) => ({ ...l, demand: round2(l.demand), assigned: round2(l.assigned) }))
      .sort((a, b) => a.disciplineName.localeCompare(b.disciplineName));
  }

  /** Every month any of this project's Cinematics' LOQs has demand — see loqRollup.ts::loqDemandPeriods. */
  projectLoqDemandPeriods(projectId: string): Period[] {
    const cinematicIds = new Set((this.cinematicsByProject.get(projectId) ?? []).map((c) => c.id));
    const loqs = this.data.loqs.filter((l) => cinematicIds.has(l.cinematicId));
    return loqDemandPeriods(loqs);
  }

  loq(loqId: string): Loq | undefined {
    return this.loqsById.get(loqId);
  }

  cinematic(cinematicId: string): Cinematic | undefined {
    return this.cinematicsById.get(cinematicId);
  }

  /** The Project a LOQ belongs to, via its Cinematic — LOQ has no direct projectId. */
  loqProject(loqId: string): Project | undefined {
    const loq = this.loqsById.get(loqId);
    const cinematic = loq ? this.cinematicsById.get(loq.cinematicId) : undefined;
    return cinematic ? this.projectsById.get(cinematic.projectId) : undefined;
  }

  /**
   * Every LOQ's forecast (docs/PLANNING_ENGINE.md §5/§6), computed once and cached on this instance
   * — safe because a fresh PlanningEngine is always constructed on every mutation (see useStore.persist).
   */
  getLoqForecasts(): Map<string, LoqForecast> {
    if (!this.loqForecastsCache) {
      this.loqForecastsCache = computeForecasts(this.data.loqs, this.data.loqDependencies, this.data.varianceEvents);
    }
    return this.loqForecastsCache;
  }

  loqForecast(loqId: string): LoqForecast | undefined {
    return this.getLoqForecasts().get(loqId);
  }

  /** Forecasts scoped to one Cinematic's LOQs — a stable-reference Map per cinematicId, cached, so a
   * Zustand selector reading it doesn't allocate a fresh object every render (see loq_events lesson:
   * a selector-allocated Map/array breaks useSyncExternalStore's reference-equality check). */
  cinematicLoqForecasts(cinematicId: string): ReadonlyMap<string, LoqForecast> {
    if (!this.loqForecastsByCinematicCache) {
      this.loqForecastsByCinematicCache = new Map();
      const all = this.getLoqForecasts();
      for (const loq of this.data.loqs) {
        const map = this.loqForecastsByCinematicCache.get(loq.cinematicId) ?? new Map<string, LoqForecast>();
        const forecast = all.get(loq.id);
        if (forecast) map.set(loq.id, forecast);
        this.loqForecastsByCinematicCache.set(loq.cinematicId, map);
      }
    }
    return this.loqForecastsByCinematicCache.get(cinematicId) ?? EMPTY_LOQ_FORECAST_MAP;
  }

  /** Whether at least one dependency edge has this LOQ as its predecessor — used by
   * loq_early_opportunity to gate on "has a downstream dependent that could be pulled earlier". */
  loqHasDownstreamDependency(loqId: string): boolean {
    return (this.dependenciesByPredecessor.get(loqId)?.length ?? 0) > 0;
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

  /** Per-project assigned FTE for one person at one period — symmetric to getProjectPersonStaffing, drives the PersonDetail UI. */
  getPersonProjectStaffing(personId: string, period: Period): PersonProjectStaffingLine[] {
    const lines: PersonProjectStaffingLine[] = [];
    for (const pa of this.personAssignmentsByPerson.get(personId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      const project = this.projectsById.get(pa.projectId);
      const fte = this.personAllocationAt(pa.id, period);
      lines.push({
        personAssignmentId: pa.id,
        projectId: pa.projectId,
        projectName: project?.name ?? pa.projectId,
        projectStatus: project ? deriveProjectStatus(project) : 'planned',
        fte,
      });
    }
    lines.sort((a, b) => a.projectName.localeCompare(b.projectName));
    return lines;
  }

  /** Every period any of a person's assignments has non-zero FTE — the window for their assignment timeline. */
  personAllocatedPeriods(personId: string): Period[] {
    const periods = new Set<Period>();
    for (const pa of this.personAssignmentsByPerson.get(personId) ?? []) {
      if (pa.scenarioId !== this.scenarioId) continue;
      for (const alloc of this.personAllocationsByAssignmentId.get(pa.id) ?? []) {
        if (Math.abs(alloc.fte) > 0.001) periods.add(alloc.period);
      }
    }
    return [...periods].sort(comparePeriod);
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
