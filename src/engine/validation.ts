import type { Period, Severity } from '../domain/types';
import { PlanningEngine, UNASSIGNED_DISCIPLINE_ID, round2 } from './planning';
import { getForecastWindowPeriods } from './forecast';
import { impactedLoqIds } from './loqForecast';
import { comparePeriod, formatPeriodLabel, periodFromISODate, periodRange } from '../domain/periods';
import { deriveProjectStatus } from '../domain/projectStatus';

export type CheckCategory =
  | 'over_capacity'
  | 'understaffed_project'
  | 'unstaffed_requirement'
  | 'invalid_dates'
  | 'tbd_dates'
  | 'available_not_assigned'
  | 'over_allocated'
  | 'assignment_without_requirement'
  | 'duration_mismatch'
  | 'unstaffed_person'
  | 'over_allocated_person'
  | 'capacity_conflict_cinematic'
  | 'loq_at_risk'
  | 'loq_root_cause'
  | 'loq_early_opportunity';

export interface SanityCheck {
  id: string;
  severity: Severity;
  category: CheckCategory;
  projectId?: string;
  projectName?: string;
  poolId?: string;
  poolName?: string;
  disciplineId?: string;
  disciplineName?: string;
  personId?: string;
  personName?: string;
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
  checks.push(...checkDurationMismatch(engine));
  checks.push(...checkInvalidDates(engine));
  checks.push(...checkTbdDates(engine));
  checks.push(...checkUnstaffedPeople(engine));
  checks.push(...checkOverAllocatedPeople(engine));
  checks.push(...checkCinematicCapacityConflict(engine));
  checks.push(...checkLoqAtRisk(engine));
  checks.push(...checkLoqRootCause(engine));
  checks.push(...checkLoqEarlyOpportunity(engine));

  for (const check of checks) {
    if (check.disciplineId) continue;
    const poolId = check.poolId;
    if (!poolId) continue;
    const pool = engine.pool(poolId);
    if (!pool) continue;
    if (pool.disciplineId) {
      check.disciplineId = pool.disciplineId;
      check.disciplineName = engine.discipline(pool.disciplineId)?.name;
    } else {
      check.disciplineId = UNASSIGNED_DISCIPLINE_ID;
      check.disciplineName = 'Unassigned';
    }
  }

  return checks.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: Severity): number {
  return s === 'critical' ? 2 : s === 'warning' ? 1 : 0;
}

/**
 * Total demand vs. total capacity for a discipline across every project in a period — scoped to
 * disciplines, not pools, because needs are discipline-only (see getProjectDisciplineStaffing):
 * they live on a hidden generic pool that always has capacityFte 0 by construction, so comparing
 * required-vs-capacity on that pool directly would flag every discipline with any need at all as
 * "over capacity" regardless of how much real capacity the discipline actually has in its specific
 * pools. Aggregating to the discipline (real capacity from its specific pools, required from
 * wherever the need is recorded) is the only granularity where this comparison means anything.
 */
function checkOverCapacity(engine: PlanningEngine, periods: Period[]): SanityCheck[] {
  const checks: SanityCheck[] = [];
  const disciplineIds: string[] = engine.disciplines().map((d) => d.id);
  if (engine.pools().some((p) => p.disciplineId === null)) disciplineIds.push(UNASSIGNED_DISCIPLINE_ID);

  for (const disciplineId of disciplineIds) {
    const disciplineName = disciplineId === UNASSIGNED_DISCIPLINE_ID ? 'Unassigned' : (engine.discipline(disciplineId)?.name ?? disciplineId);
    for (const period of periods) {
      const capacity = engine.getDisciplineCapacity(disciplineId, period);
      const required = engine.getDisciplineRequiredCapacity(disciplineId, period);
      const over = round2(required - capacity);
      if (over > 0.001) {
        checks.push({
          id: `over-capacity:${disciplineId}:${period}`,
          severity: 'critical',
          category: 'over_capacity',
          disciplineId,
          disciplineName,
          period,
          message: `${disciplineName} is over capacity in ${formatPeriodLabel(period)}`,
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
    const status = deriveProjectStatus(project);
    if (status === 'cancelled' || status === 'completed') continue;
    const periods = engine.projectActivePeriods(project.id);
    const seenUnderstaffedDiscipline = new Set<string>();

    for (const period of periods) {
      const lines = engine.getProjectDisciplineStaffing(project.id, period);
      for (const line of lines) {
        if (line.required <= 0) {
          if (line.assigned > 0.001) {
            checks.push({
              id: `assignment-without-requirement:${project.id}:${line.disciplineId}:${period}`,
              severity: 'warning',
              category: 'assignment_without_requirement',
              projectId: project.id,
              projectName: project.name,
              disciplineId: line.disciplineId,
              disciplineName: line.disciplineName,
              period,
              message: `${project.name} has ${line.disciplineName} assigned with no requirement in ${formatPeriodLabel(period)}`,
              impact: `${line.assigned} FTE assigned but no requirement exists for this discipline/period`,
            });
          }
          continue;
        }

        if (line.gap > 0.001) {
          checks.push({
            id: `over-allocated:${project.id}:${line.disciplineId}:${period}`,
            severity: 'warning',
            category: 'over_allocated',
            projectId: project.id,
            projectName: project.name,
            disciplineId: line.disciplineId,
            disciplineName: line.disciplineName,
            period,
            message: `${project.name} is over-allocated on ${line.disciplineName} in ${formatPeriodLabel(period)}`,
            impact: `Assigned ${line.assigned} FTE exceeds requirement ${line.required} FTE by ${round2(line.gap)} FTE`,
          });
        }

        if (line.assigned <= 0.001) {
          // No assignment at all for this discipline on this project — a distinct, more severe case.
          const key = `${project.id}:${line.disciplineId}`;
          if (!seenUnderstaffedDiscipline.has(key)) {
            seenUnderstaffedDiscipline.add(key);
            checks.push({
              id: `unstaffed:${key}`,
              severity: 'critical',
              category: 'unstaffed_requirement',
              projectId: project.id,
              projectName: project.name,
              disciplineId: line.disciplineId,
              disciplineName: line.disciplineName,
              message: `${project.name} needs ${line.disciplineName} but has no assignment`,
              impact: `Requirement of up to ${line.required} FTE has zero staffing`,
            });
          }
          continue;
        }

        if (line.gap < -0.001) {
          const missing = round2(-line.gap);
          const severity: Severity = project.priority === 'critical' || project.priority === 'high' ? 'critical' : 'warning';
          checks.push({
            id: `understaffed:${project.id}:${line.disciplineId}:${period}`,
            severity,
            category: 'understaffed_project',
            projectId: project.id,
            projectName: project.name,
            disciplineId: line.disciplineId,
            disciplineName: line.disciplineName,
            period,
            message: `${project.name} is understaffed on ${line.disciplineName} in ${formatPeriodLabel(period)}`,
            impact: `Missing ${missing} FTE (required ${line.required}, assigned ${line.assigned})`,
          });

          const available = round2(engine.getDisciplineCapacity(line.disciplineId, period) - engine.getDisciplineAssignedCapacity(line.disciplineId, period));
          if (available > 0.001) {
            checks.push({
              id: `available:${project.id}:${line.disciplineId}:${period}`,
              severity: 'info',
              category: 'available_not_assigned',
              projectId: project.id,
              projectName: project.name,
              disciplineId: line.disciplineId,
              disciplineName: line.disciplineName,
              period,
              message: `${line.disciplineName} has spare capacity elsewhere while ${project.name} is understaffed`,
              impact: `${round2(Math.min(available, missing))} of ${missing} FTE gap could be covered by ${available} FTE of unassigned ${line.disciplineName} capacity`,
            });
          }
        }
      }
    }
  }
  return checks;
}

/**
 * capacity_conflict_cinematic (PLANNING_ENGINE.md §1/§8): bottom-up LOQ demand for a discipline/month
 * (summed across all of a project's Cinematics — Requirement is provisioned per-project, not per-
 * Cinematic) exceeds the project's top-down Requirement for that discipline/month. Demand-vs-
 * Requirement only, never demand-vs-assigned. Runs over the union of Requirement periods and LOQ
 * demand periods, so a demand month with zero Requirement coverage is still caught.
 */
function checkCinematicCapacityConflict(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  for (const project of engine.projects()) {
    const status = deriveProjectStatus(project);
    if (status === 'cancelled' || status === 'completed') continue;

    const periods = new Set<Period>([...engine.projectActivePeriods(project.id), ...engine.projectLoqDemandPeriods(project.id)]);
    if (periods.size === 0) continue;

    for (const period of [...periods].sort(comparePeriod)) {
      const requiredByDiscipline = new Map(engine.getProjectDisciplineStaffing(project.id, period).map((l) => [l.disciplineId, l.required]));
      for (const line of engine.getProjectLoqDemand(project.id, period)) {
        const required = requiredByDiscipline.get(line.disciplineId) ?? 0;
        const overage = round2(line.demand - required);
        if (overage <= 0.001) continue;
        checks.push({
          id: `capacity-conflict-cinematic:${project.id}:${line.disciplineId}:${period}`,
          severity: 'critical',
          category: 'capacity_conflict_cinematic',
          projectId: project.id,
          projectName: project.name,
          disciplineId: line.disciplineId,
          disciplineName: line.disciplineName,
          period,
          message: `${project.name}'s LOQ demand for ${line.disciplineName} exceeds its requirement in ${formatPeriodLabel(period)}`,
          impact: `LOQ demand ${line.demand} FTE exceeds requirement ${required} FTE by ${overage} FTE`,
        });
      }
    }
  }
  return checks;
}

/** "Animation · L1 (Seq01)" — the same label convention LoqDependencyEditor already uses for a LOQ. */
function loqLabel(engine: PlanningEngine, loqId: string): string {
  const loq = engine.loq(loqId);
  if (!loq) return loqId;
  const disciplineName = engine.discipline(loq.disciplineId)?.name ?? 'Unassigned';
  const cinematicName = engine.cinematic(loq.cinematicId)?.name;
  return cinematicName ? `${disciplineName} · ${loq.type} (${cinematicName})` : `${disciplineName} · ${loq.type}`;
}

/** loq_at_risk (PLANNING_ENGINE.md §8): a LOQ whose forecast has slipped past its committed date and
 * is not yet DONE. Severity escalates to critical past a 5-calendar-day slip — a simple deterministic
 * threshold, not a heuristic. */
function checkLoqAtRisk(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  for (const [loqId, forecast] of engine.getLoqForecasts()) {
    const loq = engine.loq(loqId);
    if (!loq || loq.status === 'DONE' || forecast.deltaDays <= 0) continue;
    const project = engine.loqProject(loqId);
    const severity: Severity = forecast.deltaDays >= 5 ? 'critical' : 'warning';
    checks.push({
      id: `loq-at-risk:${loqId}`,
      severity,
      category: 'loq_at_risk',
      projectId: project?.id,
      projectName: project?.name,
      disciplineId: loq.disciplineId,
      disciplineName: engine.discipline(loq.disciplineId)?.name,
      message: `${loqLabel(engine, loqId)} is forecast to finish ${forecast.deltaDays}d late`,
      impact: `Forecast finish ${forecast.forecastFinish ?? '—'} vs. committed ${forecast.committedFinish ?? '—'} (source: ${forecast.source})`,
    });
  }
  return checks;
}

/** loq_root_cause (PLANNING_ENGINE.md §6/§8): a LOQ whose own slip (from its own variance or
 * actualFinish, never inherited) is the root cause of at least one downstream impact — surfaced once,
 * with the downstream chain named in `impact`, never as separate per-LOQ incidents. */
function checkLoqRootCause(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  const forecasts = engine.getLoqForecasts();
  for (const [loqId, forecast] of forecasts) {
    if (forecast.deltaDays <= 0 || forecast.rootCauseLoqId !== loqId) continue;
    const impacted = impactedLoqIds(loqId, forecasts);
    if (impacted.length === 0) continue;
    const loq = engine.loq(loqId);
    if (!loq) continue;
    const project = engine.loqProject(loqId);
    checks.push({
      id: `loq-root-cause:${loqId}`,
      severity: 'critical',
      category: 'loq_root_cause',
      projectId: project?.id,
      projectName: project?.name,
      disciplineId: loq.disciplineId,
      disciplineName: engine.discipline(loq.disciplineId)?.name,
      message: `${loqLabel(engine, loqId)} is the root cause of ${impacted.length} downstream ${impacted.length > 1 ? 'delays' : 'delay'}`,
      impact: `Impacts: ${impacted.map((id) => loqLabel(engine, id)).join(', ')}`,
    });
  }
  return checks;
}

/** loq_early_opportunity (PLANNING_ENGINE.md §4.2/§8): a LOQ whose forecast/actual beats its
 * committed date and has a downstream dependent — a flag only, never auto-applied to the downstream. */
function checkLoqEarlyOpportunity(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  for (const [loqId, forecast] of engine.getLoqForecasts()) {
    if (forecast.deltaDays >= 0 || !engine.loqHasDownstreamDependency(loqId)) continue;
    const loq = engine.loq(loqId);
    if (!loq) continue;
    const project = engine.loqProject(loqId);
    checks.push({
      id: `loq-early-opportunity:${loqId}`,
      severity: 'info',
      category: 'loq_early_opportunity',
      projectId: project?.id,
      projectName: project?.name,
      disciplineId: loq.disciplineId,
      disciplineName: engine.discipline(loq.disciplineId)?.name,
      message: `${loqLabel(engine, loqId)} could finish ${-forecast.deltaDays}d early`,
      impact: `Forecast finish ${forecast.forecastFinish ?? '—'} vs. committed ${forecast.committedFinish ?? '—'} — a downstream LOQ could be pulled earlier if re-committed`,
    });
  }
  return checks;
}

/** Flags assignments that reach into periods a discipline has no requirement for on that project. */
function checkDurationMismatch(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  for (const project of engine.projects()) {
    const status = deriveProjectStatus(project);
    if (status === 'cancelled' || status === 'completed') continue;
    const periods = engine.projectAllocatedPeriods(project.id);
    const disciplineIds = new Set<string>();
    for (const poolId of engine.projectPoolIds(project.id)) {
      disciplineIds.add(engine.pool(poolId)?.disciplineId ?? UNASSIGNED_DISCIPLINE_ID);
    }
    for (const disciplineId of disciplineIds) {
      const reqPeriods = new Set<Period>();
      const extraAsnPeriods: Period[] = [];
      for (const period of periods) {
        const line = engine.getProjectDisciplineStaffing(project.id, period).find((l) => l.disciplineId === disciplineId);
        if (!line) continue;
        if (line.required > 0.001) reqPeriods.add(period);
      }
      if (reqPeriods.size === 0) continue; // no requirement at all for this discipline — covered by assignment_without_requirement
      for (const period of periods) {
        const line = engine.getProjectDisciplineStaffing(project.id, period).find((l) => l.disciplineId === disciplineId);
        if (line && line.assigned > 0.001 && !reqPeriods.has(period)) extraAsnPeriods.push(period);
      }
      if (extraAsnPeriods.length > 0) {
        const disciplineName = disciplineId === UNASSIGNED_DISCIPLINE_ID ? 'Unassigned' : (engine.discipline(disciplineId)?.name ?? disciplineId);
        const list = extraAsnPeriods.sort(comparePeriod).map((p) => formatPeriodLabel(p)).join(', ');
        checks.push({
          id: `duration-mismatch:${project.id}:${disciplineId}`,
          severity: 'warning',
          category: 'duration_mismatch',
          projectId: project.id,
          projectName: project.name,
          disciplineId,
          disciplineName,
          message: `${project.name} has ${disciplineName} assigned outside its requirement's duration`,
          impact: `Assigned in ${list}, where no requirement is defined for this discipline`,
        });
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
    const status = deriveProjectStatus(project);
    if (status === 'cancelled' || status === 'completed') continue;
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

/** Active people staffed beyond their own capacity in a period, summed across every project (dispo included). */
function checkOverAllocatedPeople(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  const periods = engine.allKnownPeriods();
  for (const person of engine.people()) {
    if (!person.active) continue;
    for (const period of periods) {
      const assigned = round2(engine.getPersonAssigned(person.id, period));
      const over = round2(assigned - person.capacityFte);
      if (over > 0.001) {
        const pool = person.poolId ? engine.pool(person.poolId) : undefined;
        checks.push({
          id: `over-allocated-person:${person.id}:${period}`,
          severity: 'warning',
          category: 'over_allocated_person',
          personId: person.id,
          personName: person.name,
          poolId: person.poolId ?? undefined,
          poolName: pool?.name,
          period,
          message: `${person.name} is over-allocated in ${formatPeriodLabel(period)}`,
          impact: `Staffed ${assigned} FTE across all projects, ${over} FTE over their ${person.capacityFte} FTE capacity`,
        });
      }
    }
  }
  return checks;
}

/** Active people with capacity but no real assignment anywhere in the near-term forecast window —
 * parked on a "dispo"/bench project counts the same as no assignment at all. */
function checkUnstaffedPeople(engine: PlanningEngine): SanityCheck[] {
  const checks: SanityCheck[] = [];
  const periods = getForecastWindowPeriods(engine, 6);
  for (const person of engine.people()) {
    if (!person.active || person.capacityFte <= 0.001) continue;
    const totalAssigned = periods.reduce((sum, period) => sum + engine.getPersonAssignedExcludingDispo(person.id, period), 0);
    if (totalAssigned > 0.001) continue;
    const pool = person.poolId ? engine.pool(person.poolId) : undefined;
    checks.push({
      id: `unstaffed-person:${person.id}`,
      severity: 'info',
      category: 'unstaffed_person',
      personId: person.id,
      personName: person.name,
      poolId: person.poolId ?? undefined,
      poolName: pool?.name,
      message: `${person.name} has no assignment in the next few months`,
      impact: `${person.capacityFte} FTE of capacity is unstaffed over the forecast window`,
    });
  }
  return checks;
}
