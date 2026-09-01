import type { Period, Severity } from '../domain/types';
import { PlanningEngine, round2 } from './planning';
import { comparePeriod, formatPeriodLabel, periodFromISODate, periodRange } from '../domain/periods';

export type CheckCategory =
  | 'over_capacity'
  | 'understaffed_project'
  | 'unstaffed_requirement'
  | 'invalid_dates'
  | 'tbd_dates'
  | 'available_not_assigned';

export interface SanityCheck {
  id: string;
  severity: Severity;
  category: CheckCategory;
  projectId?: string;
  projectName?: string;
  poolId?: string;
  poolName?: string;
  period?: Period;
  message: string;
  impact: string;
}

/**
 * Runs every V1 sanity check over the current scenario. Deterministic — no heuristics beyond
 * simple threshold comparisons, per the "no predictive AI" requirement.
 */
export function getSanityChecks(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  const periods = engine.allKnownPeriods();

  checks.push(...checkOverCapacity(engine, periods));
  checks.push(...checkProjectStaffing(engine));
  checks.push(...checkInvalidDates(engine));
  checks.push(...checkTbdDates(engine));

  return checks.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: Severity): number {
  return s === 'critical' ? 2 : s === 'warning' ? 1 : 0;
}

function checkOverCapacity(engine: PlanningEngine, periods: Period[]): SanityCheck[] {
  const checks: SanityCheck[] = [];
  for (const pool of engine.pools()) {
    for (const period of periods) {
      const capacity = engine.getCapacity(pool.id, period);
      const required = engine.getRequiredCapacity(pool.id, period);
      const over = round2(required - capacity);
      if (over > 0.001) {
        checks.push({
          id: `over-capacity:${pool.id}:${period}`,
          severity: 'critical',
          category: 'over_capacity',
          poolId: pool.id,
          poolName: pool.name,
          period,
          message: `${pool.name} is over capacity in ${formatPeriodLabel(period)}`,
          impact: `Demand ${required} FTE exceeds capacity ${capacity} FTE — ${over} FTE over capacity`,
        });
      }
    }
  }
  return checks;
}

function checkProjectStaffing(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  for (const project of engine.projects()) {
    if (project.status === 'cancelled' || project.status === 'completed') continue;
    const periods = engine.projectActivePeriods(project.id);
    const seenUnderstaffedPool = new Set<string>();

    for (const period of periods) {
      const staffing = engine.getProjectStaffing(project.id, period);
      for (const line of staffing.lines) {
        if (line.required <= 0) continue;

        if (line.assigned <= 0.001) {
          // No assignment at all for this pool on this project — a distinct, more severe case.
          const key = `${project.id}:${line.poolId}`;
          if (!seenUnderstaffedPool.has(key)) {
            seenUnderstaffedPool.add(key);
            checks.push({
              id: `unstaffed:${key}`,
              severity: 'critical',
              category: 'unstaffed_requirement',
              projectId: project.id,
              projectName: project.name,
              poolId: line.poolId,
              poolName: line.poolName,
              message: `${project.name} needs ${line.poolName} but has no assignment`,
              impact: `Requirement of up to ${line.required} FTE has zero staffing`,
            });
          }
          continue;
        }

        if (line.gap < -0.001) {
          const missing = round2(-line.gap);
          const severity: Severity = project.priority === 'critical' || project.priority === 'high' ? 'critical' : 'warning';
          checks.push({
            id: `understaffed:${project.id}:${line.poolId}:${period}`,
            severity,
            category: 'understaffed_project',
            projectId: project.id,
            projectName: project.name,
            poolId: line.poolId,
            poolName: line.poolName,
            period,
            message: `${project.name} is understaffed on ${line.poolName} in ${formatPeriodLabel(period)}`,
            impact: `Missing ${missing} FTE (required ${line.required}, assigned ${line.assigned})`,
          });

          const available = engine.getAvailableCapacity(line.poolId, period);
          if (available > 0.001) {
            checks.push({
              id: `available:${project.id}:${line.poolId}:${period}`,
              severity: 'info',
              category: 'available_not_assigned',
              projectId: project.id,
              projectName: project.name,
              poolId: line.poolId,
              poolName: line.poolName,
              period,
              message: `${line.poolName} has spare capacity elsewhere while ${project.name} is understaffed`,
              impact: `${round2(Math.min(available, missing))} of ${missing} FTE gap could be covered by ${available} FTE of unassigned ${line.poolName} capacity`,
            });
          }
        }
      }
    }
  }
  return checks;
}

function checkInvalidDates(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  for (const project of engine.projects()) {
    if (project.startDate && project.endDate && project.startDate > project.endDate) {
      checks.push({
        id: `invalid-dates:${project.id}`,
        severity: 'critical',
        category: 'invalid_dates',
        projectId: project.id,
        projectName: project.name,
        message: `${project.name} ends before it starts`,
        impact: `End date (${project.endDate}) is earlier than start date (${project.startDate})`,
      });
    }

    const lifecycle = periodRange(periodFromISODate(project.startDate), periodFromISODate(project.endDate));
    if (lifecycle.length === 0) continue; // TBD project — no lifecycle to validate allocations against

    const lifecycleSet = new Set(lifecycle);
    const outside = new Set<Period>();
    for (const period of engine.projectAllocatedPeriods(project.id)) {
      if (!lifecycleSet.has(period)) outside.add(period);
    }
    if (outside.size > 0) {
      const list = [...outside].sort(comparePeriod).map((p) => formatPeriodLabel(p)).join(', ');
      checks.push({
        id: `outside-lifecycle:${project.id}`,
        severity: 'warning',
        category: 'invalid_dates',
        projectId: project.id,
        projectName: project.name,
        message: `${project.name} has allocations outside its project dates`,
        impact: `Allocated period(s) fall outside ${project.startDate} – ${project.endDate}: ${list}`,
      });
    }
  }
  return checks;
}

function checkTbdDates(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  for (const project of engine.projects()) {
    if (project.status === 'cancelled' || project.status === 'completed') continue;
    if (project.startCertainty === 'tbd' || project.endCertainty === 'tbd') {
      checks.push({
        id: `tbd:${project.id}`,
        severity: 'warning',
        category: 'tbd_dates',
        projectId: project.id,
        projectName: project.name,
        message: `${project.name} has TBD dates`,
        impact: 'Timeline placement and capacity forecasting are limited until dates are confirmed',
      });
    }
  }
  return checks;
}
