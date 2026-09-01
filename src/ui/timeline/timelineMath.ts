import type { Period } from '../../domain/types';
import { addMonths, comparePeriod, parsePeriod, periodFromDate, todayPeriod } from '../../domain/periods';

export function daysInMonth(period: Period): number {
  const { year, month0 } = parsePeriod(period);
  return new Date(year, month0 + 1, 0).getDate();
}

export function monthWidthPx(period: Period, pxPerDay: number): number {
  return daysInMonth(period) * pxPerDay;
}

export function isoToDayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function isoAddDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function isoDiffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

/** Window of months to render, padded around the plan's known range and today. */
export function buildTimelineWindow(knownPeriods: Period[], padBefore = 1, padAfter = 9): Period[] {
  const today = todayPeriod();
  let start = today;
  let end = today;
  for (const p of knownPeriods) {
    if (comparePeriod(p, start) < 0) start = p;
    if (comparePeriod(p, end) > 0) end = p;
  }
  start = addMonths(start, -padBefore);
  end = addMonths(end, padAfter);

  const result: Period[] = [];
  let cursor = start;
  let guard = 0;
  while (comparePeriod(cursor, end) <= 0 && guard < 400) {
    result.push(cursor);
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return result;
}

/** Pixel offset (from window start) for an ISO date, given uniform pxPerDay and the visible window. */
export function xForIsoDate(iso: string, window: Period[], pxPerDay: number): number {
  if (window.length === 0) return 0;
  const { year, month0 } = parsePeriod(window[0]);
  const windowStartIso = `${year}-${String(month0 + 1).padStart(2, '0')}-01`;
  return isoDiffDays(windowStartIso, iso) * pxPerDay;
}

export function isoDateForX(x: number, window: Period[], pxPerDay: number): string {
  if (window.length === 0) return isoAddDays(periodFromDate(new Date()) + '-01', 0);
  const { year, month0 } = parsePeriod(window[0]);
  const windowStartIso = `${year}-${String(month0 + 1).padStart(2, '0')}-01`;
  const deltaDays = Math.round(x / pxPerDay);
  return isoAddDays(windowStartIso, deltaDays);
}

export function totalWindowWidth(window: Period[], pxPerDay: number): number {
  return window.reduce((sum, p) => sum + monthWidthPx(p, pxPerDay), 0);
}
