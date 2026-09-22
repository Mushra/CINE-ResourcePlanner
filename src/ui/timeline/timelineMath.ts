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

export type TimelineGranularity = 'month' | 'week' | 'day';

/** Below ~7px/day a week tick is unreadable; below ~18px/day a day tick is unreadable — so the fine
 * axis (header sub-row + guide lines) only subdivides down to what's actually legible at the
 * current zoom. Data cells stay month-aggregated regardless of granularity (see Phase 3 plan). */
export function timelineGranularity(pxPerDay: number): TimelineGranularity {
  if (pxPerDay >= 18) return 'day';
  if (pxPerDay >= 7) return 'week';
  return 'month';
}

/** ISO dates of every day (day granularity) or every Monday (week granularity) inside the visible
 * window — ticks for the fine-axis header sub-row and its vertical guide lines. Empty at 'month'
 * granularity, where the month header row alone is the axis. */
export function fineAxisTicks(window: Period[], granularity: TimelineGranularity): string[] {
  if (granularity === 'month' || window.length === 0) return [];
  const { year, month0 } = parsePeriod(window[0]);
  const windowStartIso = `${year}-${String(month0 + 1).padStart(2, '0')}-01`;
  const lastMonth = window[window.length - 1];
  const { year: endYear, month0: endMonth0 } = parsePeriod(lastMonth);
  const windowEndIso = isoAddDays(`${endYear}-${String(endMonth0 + 1).padStart(2, '0')}-01`, daysInMonth(lastMonth));

  const ticks: string[] = [];
  if (granularity === 'day') {
    let cursor = windowStartIso;
    let guard = 0;
    while (cursor < windowEndIso && guard < 3000) {
      ticks.push(cursor);
      cursor = isoAddDays(cursor, 1);
      guard += 1;
    }
    return ticks;
  }
  // week: align ticks to the Monday on/before the window start.
  const startDow = new Date(`${windowStartIso}T00:00:00Z`).getUTCDay(); // 0=Sun .. 6=Sat
  const backToMonday = startDow === 0 ? 6 : startDow - 1;
  let cursor = isoAddDays(windowStartIso, -backToMonday);
  let guard = 0;
  while (cursor < windowEndIso && guard < 600) {
    if (cursor >= windowStartIso) ticks.push(cursor);
    cursor = isoAddDays(cursor, 7);
    guard += 1;
  }
  return ticks;
}

export function formatIsoDateShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

let measureCanvas: HTMLCanvasElement | null = null;

/** Pixel width of `text` rendered in `font` (CSS font shorthand), via an offscreen canvas. */
export function measureTextWidth(text: string, font: string): number {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Widest `text` (each with its own `font` and `extra` allowance for icons/indent/padding), clamped to [min, max]. */
export function timelineLabelColumnWidth(
  entries: { text: string; font: string; extra: number }[],
  { min, max }: { min: number; max: number },
): number {
  let widest = min;
  for (const entry of entries) {
    widest = Math.max(widest, measureTextWidth(entry.text, entry.font) + entry.extra);
  }
  return Math.min(max, Math.ceil(widest));
}
