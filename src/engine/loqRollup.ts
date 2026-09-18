// Bottom-up LOQ discipline rollup — see docs/PLANNING_ENGINE.md §1. Pure functions, no DB/UI
// dependency, following the same free-function-over-a-snapshot shape as validation.ts/forecast.ts.
// Produces two distinct signals per discipline per month, in the same FTE units
// Requirement/RequirementAllocation already use:
//   - demand:   from the LOQ's own committedStart/committedFinish + estimateDays — exists even with
//               zero assignees.
//   - assigned: strictly from loq_resources assignment windows — zero for any LOQ with no window
//               covering the queried month, never a fallback spread over the committed window.
// Neither is prorated across months: a window's/LOQ's intensity applies flat to every month it
// touches, matching how RequirementAllocation/PersonAssignmentAllocation already treat fte as a
// flat monthly intensity rather than a total-effort-days quantity.

import type { Discipline, Loq, LoqResource, Period } from '../domain/types';
import { comparePeriod, periodFromISODate, periodRange } from '../domain/periods';
import { round2 } from './planning';

export interface LoqDisciplineRollupLine {
  disciplineId: string;
  disciplineName: string;
  /** Bottom-up demand FTE (effort/duration intensity) for this discipline at this period. */
  demand: number;
  /** FTE from loq_resources windows covering this discipline at this period. */
  assigned: number;
}

/** Inclusive Mon-Fri count between two ISO dates. UTC-based so it's immune to local timezone DST. */
function workingDaysBetween(startIso: string, finishIso: string): number {
  const start = Date.UTC(...parseIso(startIso));
  const finish = Date.UTC(...parseIso(finishIso));
  if (finish < start) return 0;
  let count = 0;
  for (let t = start; t <= finish; t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

/**
 * The date of the nth working day (Mon-Fri) counting forward from startIso, where startIso itself
 * is day 1 if it's a working day (matching "a 1-working-day task starting Monday finishes Monday").
 * If startIso falls on a weekend, counting begins at the next working day. n <= 0 returns startIso.
 */
function addWorkingDays(startIso: string, n: number): string {
  if (n <= 0) return startIso;
  let t = Date.UTC(...parseIso(startIso));
  let count = 0;
  for (;;) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    if (count === n) return new Date(t).toISOString().slice(0, 10);
    t += 86_400_000;
  }
}

function parseIso(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

/** Whether period P falls within [startIso, finishIso] inclusive (by month, not day). */
function periodWithinWindow(period: Period, startIso: string | null, finishIso: string | null): boolean {
  const startPeriod = periodFromISODate(startIso);
  const finishPeriod = periodFromISODate(finishIso);
  if (!startPeriod || !finishPeriod) return false;
  return comparePeriod(period, startPeriod) >= 0 && comparePeriod(period, finishPeriod) <= 0;
}

/** Demand intensity for one LOQ, or 0 if it can't be placed/sized (see docs/PLANNING_ENGINE.md §1). */
function loqDemandIntensity(loq: Loq): number {
  if (!loq.committedStart || loq.estimateDays == null) return 0;
  const finish = loq.committedFinish ?? addWorkingDays(loq.committedStart, loq.estimateDays);
  const days = workingDaysBetween(loq.committedStart, finish);
  if (days <= 0) return 0;
  return loq.estimateDays / days;
}

function loqEffectiveFinish(loq: Loq): string | null {
  if (!loq.committedStart || loq.estimateDays == null) return loq.committedFinish;
  return loq.committedFinish ?? addWorkingDays(loq.committedStart, loq.estimateDays);
}

/**
 * Every month any of these LOQs' demand window touches, sorted — lets a caller (the
 * capacity_conflict_cinematic check) also examine months that have LOQ demand but zero Requirement,
 * which a Requirement-driven period list alone would never surface. A LOQ with no placeable window
 * (see loqDemandIntensity's 0-cases) contributes nothing.
 */
export function loqDemandPeriods(loqs: Loq[]): Period[] {
  const periods = new Set<Period>();
  for (const loq of loqs) {
    if (!loq.committedStart) continue;
    const startPeriod = periodFromISODate(loq.committedStart);
    const finishPeriod = periodFromISODate(loqEffectiveFinish(loq));
    if (!startPeriod || !finishPeriod) continue;
    for (const period of periodRange(startPeriod, finishPeriod)) periods.add(period);
  }
  return [...periods].sort(comparePeriod);
}

/**
 * A Cinematic's LOQs, summed by discipline, for one queried period — the bottom-up demand/assigned
 * rollup described in docs/PLANNING_ENGINE.md §1. One period per call, matching
 * getProjectDisciplineStaffing's caller-drives-the-window convention.
 */
export function getCinematicDisciplineRollup(
  cinematicId: string,
  loqs: Loq[],
  loqResources: LoqResource[],
  disciplines: Discipline[],
  period: Period,
): LoqDisciplineRollupLine[] {
  const disciplinesById = new Map(disciplines.map((d) => [d.id, d]));
  const cinematicLoqs = loqs.filter((l) => l.cinematicId === cinematicId);
  const cinematicLoqIds = new Set(cinematicLoqs.map((l) => l.id));

  const lines = new Map<string, LoqDisciplineRollupLine>();
  const lineFor = (disciplineId: string): LoqDisciplineRollupLine => {
    let line = lines.get(disciplineId);
    if (!line) {
      line = { disciplineId, disciplineName: disciplinesById.get(disciplineId)?.name ?? 'Unassigned', demand: 0, assigned: 0 };
      lines.set(disciplineId, line);
    }
    return line;
  };

  for (const loq of cinematicLoqs) {
    // Touch the line unconditionally (every discipline with a LOQ in this cinematic gets a row, even
    // a 0 for this particular period) — same convention as getProjectStaffing's per-requirement loop.
    const line = lineFor(loq.disciplineId);
    if (periodWithinWindow(period, loq.committedStart, loqEffectiveFinish(loq))) {
      line.demand += loqDemandIntensity(loq);
    }
  }

  const loqById = new Map(cinematicLoqs.map((l) => [l.id, l]));
  for (const resource of loqResources) {
    if (!cinematicLoqIds.has(resource.loqId)) continue;
    const loq = loqById.get(resource.loqId);
    if (!loq) continue;
    const line = lineFor(loq.disciplineId);
    if (periodWithinWindow(period, resource.startDate, resource.finishDate)) {
      line.assigned += resource.fte;
    }
  }

  return [...lines.values()]
    .map((line) => ({ ...line, demand: round2(line.demand), assigned: round2(line.assigned) }))
    .sort((a, b) => a.disciplineName.localeCompare(b.disciplineName));
}
