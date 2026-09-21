// Deterministic LOQ forecast engine — docs/PLANNING_ENGINE.md §5 (forecast) and §6 (dependency
// propagation + root-cause attribution). Pure functions over plain arrays, zero DB/UI/PlanningEngine
// dependency, following the same shape as loqRollup.ts.
//
// Deviations from a literal reading of PLANNING_ENGINE.md, both deliberate (see docs update):
//   - §5 rule 2 ("sum of undismissed variance deltas") would double-count, since the shipped
//     VarianceEvent.deltaDays is an ABSOLUTE snapshot vs the committed date at declaration time, not
//     an incremental delta. This engine instead takes the LATEST variance's forecastDateAtDeclaration
//     (the producer's most recently stated reality) per LOQ.
//   - Propagation shifts a successor's window by its predecessor's resolved delta only. lagDays is
//     not folded into the shift magnitude: it's a static gap already reflected in the successor's own
//     committedStart when the schedule was built, so once a predecessor slips, the same number of
//     days is what moves the successor — adding lagDays again would double-shift.

import type { Loq, LoqDependency, VarianceEvent } from '../domain/types';
import { isoAddDays, isoDiffDays } from '../ui/timeline/timelineMath';
import { loqEffectiveFinish } from './loqRollup';

export interface LoqForecast {
  loqId: string;
  forecastStart: string | null;
  forecastFinish: string | null;
  /** The committed baseline this forecast is compared against — loqEffectiveFinish(loq). */
  committedFinish: string | null;
  /** Signed calendar-day delta: forecastFinish - committedFinish. Positive = slipped, negative = early. */
  deltaDays: number;
  source: 'actual' | 'variance' | 'propagated' | 'committed';
  /** Null when deltaDays is 0 (nothing to attribute). Otherwise the LOQ whose own actualFinish/variance
   * originated this delta — itself, for an origin LOQ; inherited from upstream for a propagated one. */
  rootCauseLoqId: string | null;
}

function committedForecast(loq: Loq): LoqForecast {
  const committedFinish = loqEffectiveFinish(loq);
  return {
    loqId: loq.id,
    forecastStart: loq.committedStart,
    forecastFinish: committedFinish,
    committedFinish,
    deltaDays: 0,
    source: 'committed',
    rootCauseLoqId: null,
  };
}

/**
 * Resolves every LOQ's forecast in dependency order (finish-to-start DAG, DFS with memoization).
 * The DAG is guaranteed acyclic by wouldCreateCycle at write time; a visited-guard here is purely
 * defensive and falls back to the committed baseline rather than recursing forever.
 */
export function computeForecasts(
  loqs: Loq[],
  dependencies: LoqDependency[],
  varianceEvents: VarianceEvent[],
): Map<string, LoqForecast> {
  const loqsById = new Map(loqs.map((l) => [l.id, l]));

  const predecessorsOf = new Map<string, LoqDependency[]>();
  for (const dep of dependencies) {
    if (dep.type !== 'finish_to_start') continue; // only finish_to_start is produced today (see LoqDependency.type doc)
    const list = predecessorsOf.get(dep.successorLoqId) ?? [];
    list.push(dep);
    predecessorsOf.set(dep.successorLoqId, list);
  }

  const variancesByLoq = new Map<string, VarianceEvent[]>();
  for (const event of varianceEvents) {
    const list = variancesByLoq.get(event.loqId) ?? [];
    list.push(event);
    variancesByLoq.set(event.loqId, list);
  }

  const forecasts = new Map<string, LoqForecast>();
  const resolving = new Set<string>();

  function resolve(loqId: string): LoqForecast {
    const cached = forecasts.get(loqId);
    if (cached) return cached;

    const loq = loqsById.get(loqId);
    if (!loq) {
      const missing: LoqForecast = {
        loqId,
        forecastStart: null,
        forecastFinish: null,
        committedFinish: null,
        deltaDays: 0,
        source: 'committed',
        rootCauseLoqId: null,
      };
      forecasts.set(loqId, missing);
      return missing;
    }

    if (resolving.has(loqId)) {
      const fallback = committedForecast(loq);
      forecasts.set(loqId, fallback);
      return fallback;
    }
    resolving.add(loqId);

    const committedFinish = loqEffectiveFinish(loq);
    let forecast: LoqForecast;

    if (loq.actualFinish) {
      const deltaDays = committedFinish ? isoDiffDays(committedFinish, loq.actualFinish) : 0;
      forecast = {
        loqId,
        forecastStart: loq.committedStart,
        forecastFinish: loq.actualFinish,
        committedFinish,
        deltaDays,
        source: 'actual',
        rootCauseLoqId: deltaDays !== 0 ? loqId : null,
      };
    } else {
      const variances = variancesByLoq.get(loqId) ?? [];
      const latestVariance = variances.reduce<VarianceEvent | null>(
        (latest, v) => (!latest || v.declaredAt > latest.declaredAt ? v : latest),
        null,
      );

      if (latestVariance?.forecastDateAtDeclaration) {
        const forecastFinish = latestVariance.forecastDateAtDeclaration;
        const deltaDays = committedFinish ? isoDiffDays(committedFinish, forecastFinish) : 0;
        forecast = {
          loqId,
          forecastStart: loq.committedStart,
          forecastFinish,
          committedFinish,
          deltaDays,
          source: 'variance',
          rootCauseLoqId: deltaDays !== 0 ? loqId : null,
        };
      } else {
        const preds = predecessorsOf.get(loqId) ?? [];
        let maxDelta = 0;
        let rootCauseLoqId: string | null = null;
        for (const dep of preds) {
          const predForecast = resolve(dep.predecessorLoqId);
          if (Math.abs(predForecast.deltaDays) > Math.abs(maxDelta)) {
            maxDelta = predForecast.deltaDays;
            rootCauseLoqId = predForecast.rootCauseLoqId ?? predForecast.loqId;
          }
        }

        if (maxDelta !== 0 && committedFinish) {
          forecast = {
            loqId,
            forecastStart: loq.committedStart ? isoAddDays(loq.committedStart, maxDelta) : null,
            forecastFinish: isoAddDays(committedFinish, maxDelta),
            committedFinish,
            deltaDays: maxDelta,
            source: 'propagated',
            rootCauseLoqId,
          };
        } else {
          forecast = committedForecast(loq);
        }
      }
    }

    resolving.delete(loqId);
    forecasts.set(loqId, forecast);
    return forecast;
  }

  for (const loq of loqs) resolve(loq.id);
  return forecasts;
}

/**
 * LOQs whose forecast delta is attributed back to rootCauseLoqId (excluding itself) — lets the
 * loq_root_cause check name its downstream impact chain without duplicating the propagation walk.
 */
export function impactedLoqIds(rootCauseLoqId: string, forecasts: Map<string, LoqForecast>): string[] {
  const impacted: string[] = [];
  for (const [loqId, forecast] of forecasts) {
    if (loqId !== rootCauseLoqId && forecast.rootCauseLoqId === rootCauseLoqId) impacted.push(loqId);
  }
  return impacted;
}
