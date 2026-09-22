import type { Period } from './types';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Builds a Period key from a year and 0-indexed month. */
export function makePeriod(year: number, month0: number): Period {
  const y = year + Math.floor(month0 / 12);
  const m = ((month0 % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function periodFromDate(date: Date): Period {
  return makePeriod(date.getFullYear(), date.getMonth());
}

/** Parses an ISO date string (yyyy-mm-dd) into its Period, or null for TBD dates. */
export function periodFromISODate(iso: string | null): Period | null {
  if (!iso) return null;
  const [y, m] = iso.split('-').map(Number);
  return makePeriod(y, m - 1);
}

export function todayPeriod(): Period {
  return periodFromDate(new Date());
}

export function parsePeriod(period: Period): { year: number; month0: number } {
  const [y, m] = period.split('-').map(Number);
  return { year: y, month0: m - 1 };
}

export function addMonths(period: Period, n: number): Period {
  const { year, month0 } = parsePeriod(period);
  return makePeriod(year, month0 + n);
}

export function comparePeriod(a: Period, b: Period): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole-month difference `b - a`, e.g. `monthsBetween('2025-01', '2025-04') === 3`. */
export function monthsBetween(a: Period, b: Period): number {
  const pa = parsePeriod(a);
  const pb = parsePeriod(b);
  return (pb.year - pa.year) * 12 + (pb.month0 - pa.month0);
}

/** Inclusive list of periods from start to end. Empty if either is null or end < start. */
export function periodRange(start: Period | null, end: Period | null): Period[] {
  if (!start || !end || comparePeriod(start, end) > 0) return [];
  const result: Period[] = [];
  let cursor = start;
  let guard = 0;
  while (comparePeriod(cursor, end) <= 0 && guard < 2000) {
    result.push(cursor);
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return result;
}

export function isoFirstDayOfPeriod(period: Period): string {
  return `${period}-01`;
}

export function isoLastDayOfPeriod(period: Period): string {
  const { year, month0 } = parsePeriod(period);
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return `${period}-${String(lastDay).padStart(2, '0')}`;
}

export function daysInMonth(period: Period): number {
  const { year, month0 } = parsePeriod(period);
  return new Date(year, month0 + 1, 0).getDate();
}

/** Days since the epoch for an ISO date (yyyy-mm-dd), UTC-based so calendar arithmetic never hits a
 * DST edge case — a private helper for monthOverlapFraction below. */
function isoToUtcDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * Fraction of `period`'s days covered by the inclusive day-precise interval [startIso, finishIso]
 * — the day-overlap prorating factor PlanningEngine uses to resolve an allocation interval into a
 * month's FTE contribution (see requirementAllocationAt/personAllocationAt in engine/planning.ts).
 * 0 when the interval doesn't touch the month at all; 1 for an interval that fully covers it —
 * which is exactly what every pre-migration monthly bucket becomes (isoFirstDayOfPeriod to
 * isoLastDayOfPeriod), which is why the v10->v11 migration is numerically lossless. Example: an
 * interval starting April 12 contributes ~0.63 to April (19 of 30 days) and 1 to May onward.
 */
export function monthOverlapFraction(startIso: string, finishIso: string, period: Period): number {
  const monthStart = isoToUtcDays(isoFirstDayOfPeriod(period));
  const monthEnd = isoToUtcDays(isoLastDayOfPeriod(period));
  const overlapStart = Math.max(monthStart, isoToUtcDays(startIso));
  const overlapEnd = Math.min(monthEnd, isoToUtcDays(finishIso));
  if (overlapEnd < overlapStart) return 0;
  return (overlapEnd - overlapStart + 1) / daysInMonth(period);
}

export function formatPeriodLabel(period: Period, opts: { withYear?: boolean } = {}): string {
  const { month0, year } = parsePeriod(period);
  const withYear = opts.withYear ?? true;
  return withYear ? `${MONTH_NAMES[month0]} ${year}` : MONTH_NAMES[month0];
}

export function formatPeriodShort(period: Period): string {
  const { month0, year } = parsePeriod(period);
  return `${MONTH_NAMES[month0]} '${String(year).slice(2)}`;
}
