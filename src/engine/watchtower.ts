// Watchtower Production view — pure derivation layer over the existing engine/validation output.
// No new stored state: health, "current LOQ per discipline", and attention items are all computed
// on read, mirroring the app's existing "derive, never store" precedent (see
// domain/projectStatus.ts::deriveProjectStatus and Projects.tsx::HealthBadge).

import type { Cinematic, Loq, LoqDependency } from '../domain/types';
import type { LoqForecast } from './loqForecast';
import type { CheckCategory, SanityCheck } from './validation';
import type { PlanningEngine } from './planning';

export type WatchtowerHealth = 'ahead' | 'on-track' | 'at-risk' | 'late' | 'blocked';

/** Display order (best to worst) — matches the prototype's health strip. */
export const HEALTH_ORDER: WatchtowerHealth[] = ['ahead', 'on-track', 'at-risk', 'late', 'blocked'];

/** Severity ranking for "worst of" rollups — blocked is worst, matching the prototype's HORDER. */
const HEALTH_SEVERITY: Record<WatchtowerHealth, number> = { ahead: 0, 'on-track': 1, 'at-risk': 2, late: 3, blocked: 4 };

export const HEALTH_LABEL: Record<WatchtowerHealth, string> = {
  ahead: 'Ahead', 'on-track': 'On track', 'at-risk': 'At risk', late: 'Late', blocked: 'Blocked',
};

export const LOQ_STATUS_LABEL: Record<Loq['status'], string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };

/** "On hold" (paused) is a distinct manual flag from LoqStatus — see Loq.paused in domain/types.ts. */
export function loqStatusLabel(loq: Loq): string {
  return loq.paused ? 'On hold' : LOQ_STATUS_LABEL[loq.status];
}

/**
 * Health has no stored field anywhere in the schema — derived from the same signals the
 * loq_at_risk check already uses (LoqForecast.deltaDays, threshold 5 = critical) plus the LOQ's own
 * paused flag. A DONE LOQ can only read as ahead/on-track/late (finished early/on-time/late) —
 * "at risk" describes unresolved risk, which doesn't apply once the work is actually finished.
 */
export function deriveLoqHealth(loq: Loq, forecast: LoqForecast | undefined): WatchtowerHealth {
  if (loq.paused) return 'blocked';
  const delta = forecast?.deltaDays ?? 0;
  if (loq.status === 'DONE') {
    if (delta > 0) return 'late';
    if (delta < 0) return 'ahead';
    return 'on-track';
  }
  if (delta >= 5) return 'late';
  if (delta > 0) return 'at-risk';
  if (delta < 0) return 'ahead';
  return 'on-track';
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
 * prefer IN_PROGRESS, else the earliest not-yet-DONE, else the most recently DONE. Computed on read,
 * never stored — a future LOQ change simply changes which one this resolves to.
 */
export function representativeLoq(loqs: Loq[], cinematicId: string, disciplineId: string): Loq | null {
  const candidates = loqs.filter((l) => l.cinematicId === cinematicId && l.disciplineId === disciplineId);
  if (candidates.length === 0) return null;
  const inProgress = candidates.filter((l) => l.status === 'IN_PROGRESS');
  if (inProgress.length > 0) return pickEarliestByCommittedStart(inProgress);
  const notDone = candidates.filter((l) => l.status !== 'DONE');
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
): WatchtowerHealth | null {
  let worst: WatchtowerHealth | null = null;
  for (const disciplineId of disciplineIds) {
    const loq = representativeLoq(loqs, cinematicId, disciplineId);
    if (!loq) continue;
    const health = deriveLoqHealth(loq, forecasts.get(loq.id));
    if (worst === null || HEALTH_SEVERITY[health] > HEALTH_SEVERITY[worst]) worst = health;
  }
  return worst;
}

export type CinematicOverallStatus = 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE';
export const CINEMATIC_STATUS_LABEL: Record<CinematicOverallStatus, string> = {
  TODO: 'Planned', IN_PROGRESS: 'In progress', ON_HOLD: 'On hold', DONE: 'Done',
};

/** Rolls every discipline's representative LOQ up into one Cinematic-level status, precedence
 * On Hold > In Progress > Planned > Done — matches the prototype's `cinStatus()`. Null when the
 * Cinematic has no LOQs at all yet (nothing to roll up). */
export function cinematicStatus(cinematicId: string, disciplineIds: string[], loqs: Loq[]): CinematicOverallStatus | null {
  const active = disciplineIds
    .map((disciplineId) => representativeLoq(loqs, cinematicId, disciplineId))
    .filter((loq): loq is Loq => loq !== null);
  if (active.length === 0) return null;
  if (active.some((l) => l.paused)) return 'ON_HOLD';
  if (active.some((l) => l.status === 'IN_PROGRESS')) return 'IN_PROGRESS';
  if (active.some((l) => l.status === 'TODO')) return 'TODO';
  return 'DONE';
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
): string | null {
  let worstId: string | null = null;
  let worstHealth: WatchtowerHealth | null = null;
  for (const disciplineId of disciplineIds) {
    const loq = representativeLoq(loqs, cinematicId, disciplineId);
    if (!loq) continue;
    const health = deriveLoqHealth(loq, forecasts.get(loq.id));
    if (worstHealth === null || HEALTH_SEVERITY[health] > HEALTH_SEVERITY[worstHealth]) {
      worstHealth = health;
      worstId = disciplineId;
    }
  }
  return worstId;
}

/** Counts every (Cinematic, Discipline) cell with a representative LOQ, bucketed by health — feeds
 * the Control Room's health strip. */
export function healthCounts(
  cinematics: Cinematic[],
  disciplineIds: string[],
  loqs: Loq[],
  forecasts: ReadonlyMap<string, LoqForecast>,
): Record<WatchtowerHealth, number> {
  const counts: Record<WatchtowerHealth, number> = { ahead: 0, 'on-track': 0, 'at-risk': 0, late: 0, blocked: 0 };
  for (const cinematic of cinematics) {
    for (const disciplineId of disciplineIds) {
      const loq = representativeLoq(loqs, cinematic.id, disciplineId);
      if (!loq) continue;
      counts[deriveLoqHealth(loq, forecasts.get(loq.id))] += 1;
    }
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

export interface DependencyEndpoint {
  loq: Loq;
  cinematicName: string;
  disciplineName: string;
}

export interface DependencyEdge {
  dependency: LoqDependency;
  predecessor: DependencyEndpoint;
  successor: DependencyEndpoint;
}

/**
 * Every dependency edge whose two endpoints both resolve within the given (project-scoped) LOQs —
 * unlike LoqDependencyEditor (which only shows edges within a single Cinematic), this resolves
 * cross-Cinematic edges too, since the .mpp importer creates them with no such restriction. Read
 * model only; authoring stays on LoqDependencyEditor.
 */
export function projectDependencyEdges(
  loqs: Loq[],
  cinematics: Cinematic[],
  disciplines: { id: string; name: string }[],
  dependencies: LoqDependency[],
): DependencyEdge[] {
  const loqById = new Map(loqs.map((l) => [l.id, l]));
  const cinematicName = (id: string) => cinematics.find((c) => c.id === id)?.name ?? id;
  const disciplineName = (id: string) => disciplines.find((d) => d.id === id)?.name ?? id;

  function endpoint(loq: Loq): DependencyEndpoint {
    return { loq, cinematicName: cinematicName(loq.cinematicId), disciplineName: disciplineName(loq.disciplineId) };
  }

  const edges: DependencyEdge[] = [];
  for (const dependency of dependencies) {
    const predecessorLoq = loqById.get(dependency.predecessorLoqId);
    const successorLoq = loqById.get(dependency.successorLoqId);
    if (!predecessorLoq || !successorLoq) continue;
    edges.push({ dependency, predecessor: endpoint(predecessorLoq), successor: endpoint(successorLoq) });
  }
  return edges;
}

/** Every sanity check scoped to a project, re-shaped into the prototype's Attention item — the
 * problem/impact text is already carried on the check, this just resolves the source label and,
 * when the check names a LOQ, the Cinematic it belongs to (for drill-in). */
export function projectAttention(engine: PlanningEngine, checks: SanityCheck[], projectId: string): AttentionItem[] {
  return checks
    .filter((c) => c.projectId === projectId)
    .map((check) => {
      const loq = check.loqId ? engine.loq(check.loqId) : undefined;
      const cinematic = loq ? engine.cinematic(loq.cinematicId) : undefined;
      return {
        check,
        cinematicId: cinematic?.id ?? null,
        cinematicName: cinematic?.name ?? null,
        source: attentionSource(check.category),
      };
    });
}
