import type {
  PlanningData,
  Period,
  Project,
  ResourcePool,
} from '../domain/types';
import { periodRange, periodFromISODate, comparePeriod } from '../domain/periods';

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

/**
 * Pure, DB/UI-free calculation engine over a PlanningData snapshot. All reads are scoped to a
 * single scenario (defaulting to the base scenario) so future what-if scenarios are just a
 * different scenarioId passed to the constructor.
 */
export class PlanningEngine {
  private readonly data: PlanningData;
  readonly scenarioId: string;

  private readonly poolsById: Map<string, ResourcePool>;
  private readonly projectsById: Map<string, Project>;

  constructor(data: PlanningData, scenarioId?: string) {
    this.data = data;
    this.scenarioId = scenarioId ?? data.scenarios.find((s) => s.isBase)?.id ?? 'base';
    this.poolsById = new Map(data.pools.map((p) => [p.id, p]));
    this.projectsById = new Map(data.projects.map((p) => [p.id, p]));
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

  /** Capacity of a pool for a given period, honoring per-period overrides. */
  getCapacity(poolId: string, period: Period): number {
    const override = this.data.poolCapacityOverrides.find(
      (o) => o.poolId === poolId && o.period === period,
    );
    if (override) return override.capacityFte;
    return this.poolsById.get(poolId)?.capacityFte ?? 0;
  }

  /** Sum of required FTE for a pool at a period, across all projects in this scenario. */
  getRequiredCapacity(poolId: string, period: Period): number {
    let total = 0;
    for (const req of this.data.requirements) {
      if (req.poolId !== poolId || req.scenarioId !== this.scenarioId) continue;
      total += this.allocationAt(this.data.requirementAllocations, 'requirementId', req.id, period);
    }
    return round2(total);
  }

  /** Sum of assigned FTE for a pool at a period, across all projects in this scenario. */
  getAssignedCapacity(poolId: string, period: Period): number {
    let total = 0;
    for (const asn of this.data.assignments) {
      if (asn.poolId !== poolId || asn.scenarioId !== this.scenarioId) continue;
      total += this.allocationAt(this.data.assignmentAllocations, 'assignmentId', asn.id, period);
    }
    return round2(total);
  }

  /** Spare capacity not yet assigned to any project (can be negative if over-assigned). */
  getAvailableCapacity(poolId: string, period: Period): number {
    return round2(this.getCapacity(poolId, period) - this.getAssignedCapacity(poolId, period));
  }

  /** capacity - required. Negative means demand exceeds capacity ("over capacity"). */
  getCapacityGap(poolId: string, period: Period): number {
    return round2(this.getCapacity(poolId, period) - this.getRequiredCapacity(poolId, period));
  }

  isOverCapacity(poolId: string, period: Period): boolean {
    return this.getCapacityGap(poolId, period) < -0.001;
  }

  /** Required vs. assigned FTE per pool for one project at one period. */
  getProjectStaffing(projectId: string, period: Period): ProjectStaffing {
    const pools = new Map<string, ProjectStaffingLine>();

    for (const req of this.data.requirements) {
      if (req.projectId !== projectId || req.scenarioId !== this.scenarioId) continue;
      const fte = this.allocationAt(this.data.requirementAllocations, 'requirementId', req.id, period);
      const line = this.lineFor(pools, req.poolId);
      line.required += fte;
    }
    for (const asn of this.data.assignments) {
      if (asn.projectId !== projectId || asn.scenarioId !== this.scenarioId) continue;
      const fte = this.allocationAt(this.data.assignmentAllocations, 'assignmentId', asn.id, period);
      const line = this.lineFor(pools, asn.poolId);
      line.assigned += fte;
    }

    const lines = [...pools.values()]
      .map((l) => ({ ...l, required: round2(l.required), assigned: round2(l.assigned), gap: round2(l.assigned - l.required) }))
      .sort((a, b) => a.poolName.localeCompare(b.poolName));

    return { projectId, period, lines };
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
    for (const req of this.data.requirements) {
      if (req.projectId !== projectId || req.scenarioId !== this.scenarioId) continue;
      for (const a of this.data.requirementAllocations) {
        if (a.requirementId === req.id) periods.add(a.period);
      }
    }
    for (const asn of this.data.assignments) {
      if (asn.projectId !== projectId || asn.scenarioId !== this.scenarioId) continue;
      for (const a of this.data.assignmentAllocations) {
        if (a.assignmentId === asn.id) periods.add(a.period);
      }
    }
    return [...periods].sort(comparePeriod);
  }

  /** Pool ids this project has a requirement and/or assignment for, in this scenario. */
  projectPoolIds(projectId: string): string[] {
    const ids = new Set<string>();
    for (const req of this.data.requirements) {
      if (req.projectId === projectId && req.scenarioId === this.scenarioId) ids.add(req.poolId);
    }
    for (const asn of this.data.assignments) {
      if (asn.projectId === projectId && asn.scenarioId === this.scenarioId) ids.add(asn.poolId);
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
    for (const a of this.data.assignmentAllocations) periods.add(a.period);
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

  private allocationAt<T extends { period: Period }>(
    allocations: T[],
    key: keyof T,
    ownerId: string,
    period: Period,
  ): number {
    const row = allocations.find((a) => a[key] === ownerId && a.period === period);
    return (row as unknown as { fte: number } | undefined)?.fte ?? 0;
  }
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
