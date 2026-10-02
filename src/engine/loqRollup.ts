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

/** Inclusive Mon-Fri count between two ISO dates. UTC-based so it's immune to local timezone DST.
 * Returns 0 for an unparseable endpoint (never spins on a NaN timestamp). */
function workingDaysBetween(startIso: string, finishIso: string): number {
  const s = parseIso(startIso);
  const f = parseIso(finishIso);
  if (!s || !f) return 0;
  const start = Date.UTC(...s);
  const finish = Date.UTC(...f);
  if (finish < start) return 0;
  let count = 0;
  for (let t = start; t <= finish; t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

/**
 * The ISO date (yyyy-mm-dd) a task starting at startIso and lasting n working days finishes on, or
 * null when there is no derivable finish. startIso is working day 1 when it's a weekday; a weekend
 * start with a positive duration begins counting on the following Monday. A fractional n is rounded
 * UP to the whole working day that contains the finish — 0.5d from Monday finishes Monday, 1.5d from
 * Monday finishes Tuesday, 1.5d from Friday finishes Monday — while callers keep the exact fractional
 * n for load math (we never round the estimate itself). n === 0 keeps the start date; negative, NaN,
 * Infinity, an unparseable start, or a duration so large the finish falls outside the supported
 * yyyy-mm-dd range all yield null (no usable window). Computed arithmetically — no per-day loop — so
 * even an absurd n returns at once rather than spinning (the integer-loop version froze on any
 * fractional n, since count === n never held for, say, n = 1.5).
 */
function addWorkingDays(startIso: string, n: number): string | null {
  const parsed = parseIso(startIso);
  if (!parsed) return null;
  if (n === 0) return startIso;
  if (!Number.isFinite(n) || n < 0) return null;
  const workingDays = Math.ceil(n); // the whole working day containing the fractional finish
  const DAY = 86_400_000;
  let t = Date.UTC(...parsed);
  let dow = new Date(t).getUTCDay();
  // A weekend start rolls forward to Monday before counting (Monday is then working day 1).
  if (dow === 6) { t += 2 * DAY; dow = 1; } else if (dow === 0) { t += 1 * DAY; dow = 1; }
  const remaining = workingDays - 1; // the effective start already is working day 1
  const extraDays = Math.floor(remaining / 5) * 7 + ((dow + (remaining % 5) > 5) ? (remaining % 5) + 2 : (remaining % 5));
  const finish = new Date(t + extraDays * DAY);
  if (Number.isNaN(finish.getTime())) return null;
  // A finish past year 9999 (or before year 1000) serialises as the expanded "+0YYYYYY-MM-DD" /
  // "-00YYYY" form, not the yyyy-mm-dd the rest of the app relies on — treat it as out of range so a
  // huge estimate yields no window rather than a malformed date like "+013525-12".
  const iso = finish.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** Parses yyyy-mm-dd into a UTC [year, monthIndex, day] tuple, or null when the string is not a real
 * calendar date (wrong shape, non-numeric, or an impossible day such as 2026-02-30 or 2026-13-45) —
 * so a bad date degrades to "no window" instead of a NaN timestamp. */
function parseIso(iso: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const month = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, month - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== d) return null;
  return [y, month - 1, d];
}

/** Whether period P falls within [startIso, finishIso] inclusive (by month, not day). */
function periodWithinWindow(period: Period, startIso: string | null, finishIso: string | null): boolean {
  const startPeriod = periodFromISODate(startIso);
  const finishPeriod = periodFromISODate(finishIso);
  if (!startPeriod || !finishPeriod) return false;
  return comparePeriod(period, startPeriod) >= 0 && comparePeriod(period, finishPeriod) <= 0;
}

/** Whether a LOQ's estimateDays is a usable measure: a finite, non-negative number (or null, meaning
 * "unset"). A NaN/Infinity/negative estimate — however it got into the data — is NOT usable and must
 * never feed an aggregate as if it were. Exported so the validation layer can surface it (an invalid
 * estimate stays identifiable, rather than being silently swallowed as a 0). */
export function hasValidEstimate(loq: Pick<Loq, 'estimateDays'>): boolean {
  return loq.estimateDays == null || (Number.isFinite(loq.estimateDays) && loq.estimateDays >= 0);
}

/** Demand intensity for one LOQ, or 0 if it can't be placed/sized (see docs/PLANNING_ENGINE.md §1). */
function loqDemandIntensity(loq: Loq): number {
  if (!loq.committedStart || loq.estimateDays == null) return 0;
  // A non-finite or negative estimate never contaminates the rollup — even with an explicit finish,
  // where it would otherwise divide into NaN/negative demand. It contributes nothing and is flagged
  // separately (see hasValidEstimate / the invalid_estimate sanity check).
  if (!Number.isFinite(loq.estimateDays) || loq.estimateDays < 0) return 0;
  const finish = loq.committedFinish ?? addWorkingDays(loq.committedStart, loq.estimateDays);
  if (!finish) return 0; // no derivable finish (absurd estimate, bad start) → no demand
  const days = workingDaysBetween(loq.committedStart, finish);
  if (days <= 0) return 0;
  return loq.estimateDays / days;
}

/** The finish date a LOQ's window uses for rollup/display purposes: the explicit committedFinish
 * when set, else derived from committedStart + estimateDays (working days). Exported so UI code
 * (LoqTimeline) can render the same implicit window without duplicating this derivation. */
export function loqEffectiveFinish(loq: Loq): string | null {
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
