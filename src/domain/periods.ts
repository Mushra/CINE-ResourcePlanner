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

export function formatPeriodLabel(period: Period, opts: { withYear?: boolean } = {}): string {
  const { month0, year } = parsePeriod(period);
  const withYear = opts.withYear ?? true;
  return withYear ? `${MONTH_NAMES[month0]} ${year}` : MONTH_NAMES[month0];
}

export function formatPeriodShort(period: Period): string {
  const { month0, year } = parsePeriod(period);
  return `${MONTH_NAMES[month0]} '${String(year).slice(2)}`;
}
