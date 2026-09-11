import type { Period } from '../domain/types';
import { PlanningEngine } from './planning';
import { addMonths, comparePeriod, todayPeriod } from '../domain/periods';

/** Window from the earlier of today/earliest known period through `monthsAhead` months out. */
export function getForecastWindowPeriods(engine: PlanningEngine, monthsAhead: number): Period[] {
  const known = engine.allKnownPeriods();
  const today = todayPeriod();
  let start = today;
  if (known.length > 0 && comparePeriod(known[0], start) < 0) start = known[0];

  let end = addMonths(today, monthsAhead);
  if (known.length > 0 && comparePeriod(known[known.length - 1], end) > 0) end = known[known.length - 1];

  const periods: Period[] = [];
  let cursor = start;
  let guard = 0;
  while (comparePeriod(cursor, end) <= 0 && guard < 240) {
    periods.push(cursor);
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return periods;
}
