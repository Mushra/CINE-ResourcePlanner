import type { Period } from '../domain/types';
import { PlanningEngine, round2 } from './planning';
import { addMonths, comparePeriod, formatPeriodLabel, todayPeriod } from '../domain/periods';

export type UtilizationStatus = 'healthy' | 'warning' | 'critical';

export function utilizationStatus(pct: number): UtilizationStatus {
  if (pct > 100.001) return 'critical';
  if (pct >= 90) return 'warning';
  return 'healthy';
}

export interface ForecastCell {
  period: Period;
  capacity: number;
  required: number;
  utilizationPct: number;
  status: UtilizationStatus;
}

export interface ForecastPoolRow {
  poolId: string;
  poolName: string;
  cells: ForecastCell[];
}

export interface ForecastProblem {
  period: Period;
  poolId: string;
  poolName: string;
  overFte: number;
  message: string;
}

export interface Forecast {
  periods: Period[];
  rows: ForecastPoolRow[];
  problems: ForecastProblem[];
}

/**
 * Deterministic capacity forecast: for each pool and each month in the window, what % of
 * capacity is demanded. No prediction — purely a projection of already-entered requirements.
 */
export function getForecast(engine: PlanningEngine, monthsAhead = 6): Forecast {
  const periods = getForecastWindowPeriods(engine, monthsAhead);
  const rows: ForecastPoolRow[] = engine.pools().map((pool) => ({
    poolId: pool.id,
    poolName: pool.name,
    cells: periods.map((period) => {
      const capacity = engine.getCapacity(pool.id, period);
      const required = engine.getRequiredCapacity(pool.id, period);
      const utilizationPct = capacity > 0 ? round2((required / capacity) * 100) : (required > 0 ? 999 : 0);
      return { period, capacity, required, utilizationPct, status: utilizationStatus(utilizationPct) };
    }),
  }));

  const problems: ForecastProblem[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.status === 'critical') {
        const overFte = round2(cell.required - cell.capacity);
        problems.push({
          period: cell.period,
          poolId: row.poolId,
          poolName: row.poolName,
          overFte,
          message: `${formatPeriodLabel(cell.period)}: ${row.poolName} needs ${overFte} additional FTE`,
        });
      }
    }
  }
  problems.sort((a, b) => comparePeriod(a.period, b.period));

  return { periods, rows, problems };
}

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
