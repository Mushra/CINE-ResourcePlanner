// Watchtower Production view — pure derivation layer over the existing engine/validation output.
// No new stored state: health, "current LOQ per discipline", and attention items are all computed
// on read, mirroring the app's existing "derive, never store" precedent (see
// domain/projectStatus.ts::deriveProjectStatus and Projects.tsx::HealthBadge).

import type { Cinematic, JiraProjectConfig, Loq, LoqStatus } from '../domain/types';
import { CANONICAL_STATUS_LABEL, resolveJiraStatus, type EffectiveStatus } from '../domain/jiraStatusMap';
import type { LoqForecast } from './loqForecast';
import type { CheckCategory, SanityCheck } from './validation';
import type { PlanningEngine } from './planning';

export type WatchtowerHealth = 'ahead' | 'on-track' | 'on-hold' | 'at-risk' | 'late' | 'blocked';

/** Display order (best to worst). `on-hold` (a voluntary, planner-set pause) sits between healthy
 * and at-risk — it's a calm parked state, not an alarm; `blocked` (involuntary) is the true worst. */
export const HEALTH_ORDER: WatchtowerHealth[] = ['ahead', 'on-track', 'on-hold', 'at-risk', 'late', 'blocked'];

/** Severity ranking for "worst of" rollups — blocked is worst. */
const HEALTH_SEVERITY: Record<WatchtowerHealth, number> = {
  ahead: 0, 'on-track': 1, 'on-hold': 2, 'at-risk': 3, late: 4, blocked: 5,
};

export const HEALTH_LABEL: Record<WatchtowerHealth, string> = {
  ahead: 'Ahead', 'on-track': 'On track', 'on-hold': 'On hold', 'at-risk': 'At risk', late: 'Late', blocked: 'Blocked',
};

export const LOQ_STATUS_LABEL: Record<Loq['status'], string> = CANONICAL_STATUS_LABEL;

/** Resolves the status a LOQ should be shown/scored with — used by every rollup below so a
 * Jira-bound LOQ reflects its mirrored status. Defaults to the plan's own `loq.status` when no
 * effective-status entry is supplied (unbound rows, or callers that don't build the map). */
export type StatusResolver = (loq: Loq) => LoqStatus;

const OWN_STATUS: StatusResolver = (loq) => loq.status;

/** `DONE` and `CUT` are both terminal — a cut LOQ is finished-for-planning-purposes and never
 * "current" or "at risk", it's just shown distinctly (see LoqStatus). */
export function isTerminalStatus(status: LoqStatus): boolean {
  return status === 'DONE' || status === 'CUT';
}

/** "On hold" is the voluntary `Loq.paused` flag (never Jira-driven); when not paused the label is
 * the (effective) status. Pass the effective status for a Jira-bound row. */
export function loqStatusLabel(loq: Loq, status: LoqStatus = loq.status): string {
  return loq.paused ? 'On hold' : CANONICAL_STATUS_LABEL[status];
}

/**
 * Health has no stored field anywhere in the schema — derived from the same signals the
 * loq_at_risk check already uses (LoqForecast.deltaDays, threshold 5 = critical) plus the LOQ's own
 * paused flag and (effective) status. Precedence: a voluntary pause reads as the calm `on-hold`
 * (planner parked it — kept out of slip alarms); an involuntary `BLOCKED` reads as the worst
 * `blocked`. A terminal LOQ can only read ahead/on-track/late (`DONE`) or neutral (`CUT`, which is
 * never "late") — "at risk" describes unresolved risk, moot once the work is finished or cut.
 */
export function deriveLoqHealth(
  loq: Loq,
  forecast: LoqForecast | undefined,
  status: LoqStatus = loq.status,
): WatchtowerHealth {
  if (loq.paused) return 'on-hold';
  if (status === 'BLOCKED') return 'blocked';
  const delta = forecast?.deltaDays ?? 0;
  if (status === 'CUT') return 'on-track';
  if (status === 'DONE') {
    if (delta > 0) return 'late';
    if (delta < 0) return 'ahead';
    return 'on-track';
  }
  if (delta >= 5) return 'late';
  if (delta > 0) return 'at-risk';
  if (delta < 0) return 'ahead';
  return 'on-track';
}

/**
 * Effective status per LOQ: a Jira-bound + synced LOQ mirrors its issue's status (resolved through
 * the project's configurable mapping), everything else keeps `loq.status`. A bound status the
 * mapping doesn't cover is the `UNMAPPED` sentinel ("À mapper") — surfaced in the UI and as a check,
 * but for health/rollup purposes the resolver below falls back to `loq.status`. Built once (per the
 * buildJiraToleranceMap precedent) and threaded into the rollups; editing the mapping rebuilds it
 * with no re-sync (derive, never store).
 */
export function buildEffectiveStatusMap(engine: PlanningEngine, configs: JiraProjectConfig[]): Map<string, EffectiveStatus> {
  const mappingByProject = new Map(configs.map((c) => [c.projectId, c.statusMapping]));
  const result = new Map<string, EffectiveStatus>();
  for (const { loq, state } of engine.loqsWithJiraSync()) {
    if (!loq.jiraKey) continue;
    const cinematic = engine.cinematic(loq.cinematicId);
    if (!cinematic) continue;
    const resolved = resolveJiraStatus(state.jiraStatus, mappingByProject.get(cinematic.projectId) ?? null);
    result.set(loq.id, resolved ?? 'unmapped');
  }
  return result;
}

/** Turns an effective-status map into a StatusResolver for the rollups — `UNMAPPED` and missing
 * entries both fall back to the plan's own `loq.status`. */
export function statusResolverFrom(map: ReadonlyMap<string, EffectiveStatus> | null | undefined): StatusResolver {
  if (!map) return OWN_STATUS;
  return (loq) => {
    const effective = map.get(loq.id);
    return effective == null || effective === 'unmapped' ? loq.status : effective;
  };
}

function pickEarliestByCommittedStart(loqs: Loq[]): Loq {
  return [...loqs].sort((a, b) => {
    if (a.committedStart && b.committedStart) return a.committedStart.localeCompare(b.committedStart);
    if (a.committedStart) return -1;
    if (b.committedStart) return 1;
    return a.sortOrder - b.sortOrder;
  })[0];
}

function pickMostRecentlyDone(loqs: Loq[]): Loq {
  return [...loqs].sort((a, b) => {
    const af = a.actualFinish ?? a.committedFinish;
    const bf = b.actualFinish ?? b.committedFinish;
    if (af && bf) return bf.localeCompare(af);
    if (af) return -1;
    if (bf) return 1;
    return b.sortOrder - a.sortOrder;
  })[0];
}

/**
 * The prototype shows one LOQ cell per (Cinematic, Discipline) — the schema instead holds many LOQs
 * per discipline over a Cinematic's lifetime. This adapter picks the single "current" one:
 * prefer IN_PROGRESS, else the earliest non-terminal (not DONE/CUT), else the most recently
 * done/cut. Computed on read, never stored — a future LOQ change simply changes which one this
 * resolves to. `statusOf` supplies the effective (Jira-mirrored) status; defaults to `loq.status`.
 */
export function representativeLoq(
  loqs: Loq[],
  cinematicId: string,
  disciplineId: string,
  statusOf: StatusResolver = OWN_STATUS,
): Loq | null {
  const candidates = loqs.filter((l) => l.cinematicId === cinematicId && l.disciplineId === disciplineId);
  if (candidates.length === 0) return null;
  const inProgress = candidates.filter((l) => statusOf(l) === 'IN_PROGRESS');
  if (inProgress.length > 0) return pickEarliestByCommittedStart(inProgress);
  const notDone = candidates.filter((l) => !isTerminalStatus(statusOf(l)));
  if (notDone.length > 0) return pickEarliestByCommittedStart(notDone);
  return pickMostRecentlyDone(candidates);
}

/** Worst health across every discipline that has a representative LOQ for this Cinematic. Null when
 * the Cinematic has no LOQs at all yet. */
export function cinematicHealth(
  cinematicId: string,
  disciplineIds: string[],
  loqs: Loq[],
  forecasts: ReadonlyMap<string, LoqForecast>,
  statusOf: StatusResolver = OWN_STATUS,
): WatchtowerHealth | null {
  let worst: WatchtowerHealth | null = null;
  for (const disciplineId of disciplineIds) {
    const loq = representativeLoq(loqs, cinematicId, disciplineId, statusOf);
    if (!loq) continue;
    const health = deriveLoqHealth(loq, forecasts.get(loq.id), statusOf(loq));
    if (worst === null || HEALTH_SEVERITY[health] > HEALTH_SEVERITY[worst]) worst = health;
  }
  return worst;
}

export type CinematicOverallStatus = 'TODO' | 'IN_PROGRESS' | 'TO_REVIEW' | 'BLOCKED' | 'ON_HOLD' | 'DONE' | 'CUT';
export const CINEMATIC_STATUS_LABEL: Record<CinematicOverallStatus, string> = {
  TODO: 'Planned', IN_PROGRESS: 'In progress', TO_REVIEW: 'In review', BLOCKED: 'Blocked', ON_HOLD: 'On hold', DONE: 'Done', CUT: 'Cut',
};

/** Roll-up precedence (highest attention first): an involuntary BLOCKED LOQ dominates a parallel
 * in-progress one; a voluntary pause (ON_HOLD) only shows when nothing more active is happening;
 * CUT only when every discipline is cut (never masks a real DONE). */
const CINEMATIC_STATUS_PRIORITY: CinematicOverallStatus[] = ['BLOCKED', 'IN_PROGRESS', 'TO_REVIEW', 'TODO', 'ON_HOLD', 'DONE', 'CUT'];

/** Rolls every discipline's representative LOQ up into one Cinematic-level status by the priority
 * above. A paused LOQ contributes ON_HOLD regardless of its underlying status (a voluntary hold).
 * Null when the Cinematic has no LOQs at all yet (nothing to roll up). */
export function cinematicStatus(
  cinematicId: string,
  disciplineIds: string[],
  loqs: Loq[],
  statusOf: StatusResolver = OWN_STATUS,
): CinematicOverallStatus | null {
  const active = disciplineIds
    .map((disciplineId) => representativeLoq(loqs, cinematicId, disciplineId, statusOf))
    .filter((loq): loq is Loq => loq !== null);
  if (active.length === 0) return null;
  const present = new Set<CinematicOverallStatus>(active.map((l) => (l.paused ? 'ON_HOLD' : statusOf(l))));
  return CINEMATIC_STATUS_PRIORITY.find((s) => present.has(s)) ?? null;
}

/** The discipline whose representative LOQ is in the worst health for this Cinematic — the
 * "bottleneck" discipline, used by the Matrix's "Group by: Discipline" (matches the prototype's
 * `worstDiscipline`, computed the same way: worst HEALTH_SEVERITY among the Cinematic's active
 * disciplines). Null when the Cinematic has no LOQs at all yet. */
export function worstDiscipline(
  cinematicId: string,
  disciplineIds: string[],
  loqs: Loq[],
  forecasts: ReadonlyMap<string, LoqForecast>,
  statusOf: StatusResolver = OWN_STATUS,
): string | null {
  let worstId: string | null = null;
  let worstHealth: WatchtowerHealth | null = null;
  for (const disciplineId of disciplineIds) {
    const loq = representativeLoq(loqs, cinematicId, disciplineId, statusOf);
    if (!loq) continue;
    const health = deriveLoqHealth(loq, forecasts.get(loq.id), statusOf(loq));
    if (worstHealth === null || HEALTH_SEVERITY[health] > HEALTH_SEVERITY[worstHealth]) {
      worstHealth = health;
      worstId = disciplineId;
    }
  }
  return worstId;
}

/** Counts each Cinematic once, bucketed by its overall health (the worst-of-its-disciplines rollup
 * from cinematicHealth) — feeds the Control Room's health strip. A Cinematic with no LOQs yet
 * anywhere isn't counted in any bucket. */
export function healthCounts(
  cinematics: Cinematic[],
  disciplineIds: string[],
  loqs: Loq[],
  forecasts: ReadonlyMap<string, LoqForecast>,
  statusOf: StatusResolver = OWN_STATUS,
): Record<WatchtowerHealth, number> {
  const counts: Record<WatchtowerHealth, number> = { ahead: 0, 'on-track': 0, 'on-hold': 0, 'at-risk': 0, late: 0, blocked: 0 };
  for (const cinematic of cinematics) {
    const health = cinematicHealth(cinematic.id, disciplineIds, loqs, forecasts, statusOf);
    if (health) counts[health] += 1;
  }
  return counts;
}

export interface LoqLevelCount {
  level: string;
  count: number;
}

/** Distribution of representative-LOQ levels (Loq.type, e.g. "L1"/"L2"/"L3") across a project's
 * Cinematics, optionally scoped to one discipline. */
export function loqLevelDistribution(
  cinematics: Cinematic[],
  disciplineIds: string[],
  loqs: Loq[],
  filterDisciplineId?: string | null,
): LoqLevelCount[] {
  const targetDisciplines = filterDisciplineId ? [filterDisciplineId] : disciplineIds;
  const counts = new Map<string, number>();
  for (const cinematic of cinematics) {
    for (const disciplineId of targetDisciplines) {
      const loq = representativeLoq(loqs, cinematic.id, disciplineId);
      if (!loq) continue;
      counts.set(loq.type, (counts.get(loq.type) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([level, count]) => ({ level, count }));
}

export type AttentionSource = 'Watchtower' | 'Jira' | 'Production Planning';

export interface AttentionItem {
  check: SanityCheck;
  cinematicId: string | null;
  cinematicName: string | null;
  source: AttentionSource;
}

const JIRA_CATEGORIES = new Set<CheckCategory>(['jira_inconsistency']);
const PRODUCTION_PLANNING_CATEGORIES = new Set<CheckCategory>([
  'over_capacity', 'understaffed_project', 'unstaffed_requirement', 'available_not_assigned',
  'over_allocated', 'assignment_without_requirement', 'duration_mismatch', 'unstaffed_person',
  'over_allocated_person', 'capacity_conflict_cinematic',
]);

export function attentionSource(category: CheckCategory): AttentionSource {
  if (JIRA_CATEGORIES.has(category)) return 'Jira';
  if (PRODUCTION_PLANNING_CATEGORIES.has(category)) return 'Production Planning';
  return 'Watchtower'; // loq_at_risk / loq_root_cause / loq_early_opportunity / invalid_dates / tbd_dates
}

/** Every sanity check scoped to a project, re-shaped into the prototype's Attention item — the
 * problem/impact text is already carried on the check, this just resolves the source label and,
 * when the check names a LOQ, the Cinematic it belongs to (for drill-in). */
export function projectAttention(engine: PlanningEngine, checks: SanityCheck[], projectId: string): AttentionItem[] {
  return checks
    .filter((c) => c.projectId === projectId)
    .map((check) => {
      const loq = check.loqId ? engine.loq(check.loqId) : undefined;
      const cinematic = check.cinematicId
        ? engine.cinematic(check.cinematicId)
        : loq ? engine.cinematic(loq.cinematicId) : undefined;
      return {
        check,
        cinematicId: cinematic?.id ?? null,
        cinematicName: cinematic?.name ?? null,
        source: attentionSource(check.category),
      };
    });
}
