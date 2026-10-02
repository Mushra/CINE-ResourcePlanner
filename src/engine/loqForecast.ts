// Deterministic LOQ forecast engine — docs/PLANNING_ENGINE.md §5 (forecast) and §6 (dependency
// propagation + root-cause attribution). Pure functions over plain arrays, zero DB/UI/PlanningEngine
// dependency, following the same shape as loqRollup.ts.
//
// Deviations from a literal reading of PLANNING_ENGINE.md, both deliberate (see docs update):
//   - §5 rule 2 ("sum of undismissed variance deltas") would double-count, since the shipped
//     VarianceEvent.deltaDays is an ABSOLUTE snapshot vs the committed date at declaration time, not
//     an incremental delta. This engine instead takes the LATEST variance's forecastDateAtDeclaration
//     (the producer's most recently stated reality) per LOQ.
//   - §6 propagation is SLACK- and SIGN-aware (A04 "advances are opportunities, delays are threats"):
//     for each prerequisite we compute pressure = (its resolved slip) − (free float the as-built
//     schedule left between its committed finish + lag and this LOQ's committed start). The binding
//     prerequisite is the one with the GREATEST pressure, so a late prerequisite (positive pressure)
//     always dominates an early one (negative) — an advance can never mask a delay, and all
//     prerequisites are accounted for. Positive net pressure is a THREAT that shifts this LOQ's
//     forecast forward; a slip fully inside the float is absorbed (no shift). Negative net pressure is
//     an OPPORTUNITY (opportunity* fields) — a potential earliest window presented as a possibility,
//     never applied to the committed forecast or staffing without an explicit human decision. lagDays
//     feeds the float but is otherwise not folded into the shift magnitude (it's already reflected in
//     the successor's committedStart; adding it again would double-shift).

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
  /** A04 opportunity: when upstream advances/float mean this LOQ *could* start/finish earlier than its
   * committed window, the potential earliest start/finish — a POSSIBILITY only, never applied to the
   * committed forecast (deltaDays stays 0, source 'committed'). Null / 0 when there's no pull-in. */
  opportunityStart: string | null;
  opportunityFinish: string | null;
  /** Calendar days this LOQ could be pulled in (≥ 0), bounded by the latest-finishing prerequisite. */
  opportunityDays: number;
  /** The binding prerequisite whose advance enables the opportunity, or null when there is none. */
  opportunityRootCauseLoqId: string | null;
}

/** Opportunity fields default to "no opportunity" — populated only on the dependency-propagation path
 * when upstream advances/float let this LOQ *potentially* start earlier (a possibility, never applied). */
const NO_OPPORTUNITY = {
  opportunityStart: null,
  opportunityFinish: null,
  opportunityDays: 0,
  opportunityRootCauseLoqId: null,
} as const;

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
    ...NO_OPPORTUNITY,
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
        ...NO_OPPORTUNITY,
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
        ...NO_OPPORTUNITY,
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
          ...NO_OPPORTUNITY,
        };
      } else {
        // Net dependency pressure across ALL prerequisites (see header §6). pressure_i = predecessor
        // slip − free float left before this LOQ's committed start; the binding prerequisite is the
        // one with the greatest pressure, so a delay always wins over a concurrent advance.
        const preds = predecessorsOf.get(loqId) ?? [];
        let netPressure = 0;
        let hasPred = false;
        let bindingCauseLoqId: string | null = null;
        let bindingPredDelta = 0;
        for (const dep of preds) {
          const predForecast = resolve(dep.predecessorLoqId);
          if (predForecast.forecastFinish == null || predForecast.committedFinish == null) continue;
          const freeFloat = loq.committedStart
            ? Math.max(0, isoDiffDays(isoAddDays(predForecast.committedFinish, dep.lagDays), loq.committedStart))
            : 0;
          const pressure = predForecast.deltaDays - freeFloat;
          if (!hasPred || pressure > netPressure) {
            netPressure = pressure;
            bindingCauseLoqId = predForecast.rootCauseLoqId ?? predForecast.loqId;
            bindingPredDelta = predForecast.deltaDays;
          }
          hasPred = true;
        }

        if (netPressure > 0 && committedFinish) {
          // THREAT: the binding prerequisite slips past the float; shift the forecast window forward.
          forecast = {
            loqId,
            forecastStart: loq.committedStart ? isoAddDays(loq.committedStart, netPressure) : null,
            forecastFinish: isoAddDays(committedFinish, netPressure),
            committedFinish,
            deltaDays: netPressure,
            source: 'propagated',
            rootCauseLoqId: bindingCauseLoqId,
            ...NO_OPPORTUNITY,
          };
        } else {
          // No threat: the committed forecast stands — a commitment is never pulled in automatically.
          // An OPPORTUNITY is surfaced only when the binding prerequisite genuinely finished EARLIER
          // than its own committed date (bindingPredDelta < 0): the potential pull-in is then the
          // advance plus any float the as-built schedule left. Pre-existing float on a prerequisite
          // that did NOT advance is a planning choice, not a new opportunity, so it is not reported.
          const base = committedForecast(loq);
          const pullIn = hasPred && bindingPredDelta < 0 ? Math.max(0, -netPressure) : 0;
          if (pullIn > 0 && loq.committedStart && committedFinish) {
            forecast = {
              ...base,
              opportunityStart: isoAddDays(loq.committedStart, -pullIn),
              opportunityFinish: isoAddDays(committedFinish, -pullIn),
              opportunityDays: pullIn,
              opportunityRootCauseLoqId: bindingCauseLoqId,
            };
          } else {
            forecast = base;
          }
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
