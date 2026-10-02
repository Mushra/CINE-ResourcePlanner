// Watchtower Production view — pure derivation layer over the existing engine/validation output.
// No new stored state: health, "current LOQ per discipline", and attention items are all computed
// on read, mirroring the app's existing "derive, never store" precedent (see
// domain/projectStatus.ts::deriveProjectStatus and Projects.tsx::HealthBadge).

import type { Cinematic, JiraProjectConfig, Loq, LoqStatus } from '../domain/types';
import { CANONICAL_STATUS_LABEL, resolveJiraStatus, type EffectiveStatus } from '../domain/jiraStatusMap';
import { localTodayIso } from '../domain/projectStatus';
import { isoDiffDays } from '../ui/timeline/timelineMath';
import { loqEffectiveFinish } from './loqRollup';
import type { LoqForecast } from './loqForecast';
import type { CheckCategory, SanityCheck } from './validation';
import type { PlanningEngine } from './planning';

/** `unknown` (A05) is the explicit "we cannot currently confirm this" state — a Jira-bound LOQ whose
 * authoritative status we can't trust (never synced, stale, or an unmapped Jira status) and which
 * shows no other definitive signal (not blocked, not overdue, no slip). It is deliberately NOT
 * `on-track`: the mere absence of a declared variance must never, on its own, assert On track. */
export type WatchtowerHealth = 'ahead' | 'on-track' | 'on-hold' | 'unknown' | 'at-risk' | 'late' | 'blocked';

/** Display order (best to worst). `on-hold` (a voluntary, planner-set pause) sits between healthy
 * and at-risk — it's a calm parked state, not an alarm; `unknown` sits just past it (uncertainty is
 * more attention-worthy than a known calm state, but a concrete threat still dominates it); `blocked`
 * (involuntary) is the true worst. */
export const HEALTH_ORDER: WatchtowerHealth[] = ['ahead', 'on-track', 'on-hold', 'unknown', 'at-risk', 'late', 'blocked'];

/** Severity ranking for "worst of" rollups — blocked is worst. `unknown` outranks the calm states
 * (so a cinematic with one unconfirmable discipline surfaces the uncertainty) but yields to any
 * concrete threat (at-risk/late/blocked), which is known and actionable. */
const HEALTH_SEVERITY: Record<WatchtowerHealth, number> = {
  ahead: 0, 'on-track': 1, 'on-hold': 2, unknown: 3, 'at-risk': 4, late: 5, blocked: 6,
};

export const HEALTH_LABEL: Record<WatchtowerHealth, string> = {
  ahead: 'Ahead', 'on-track': 'On track', 'on-hold': 'On hold', unknown: 'Unknown', 'at-risk': 'At risk', late: 'Late', blocked: 'Blocked',
};

/** How many days a Jira sync stays "fresh" before health treats the mirrored status as stale and the
 * LOQ as unconfirmable. A department-wide default kept here as the single source of truth; a future
 * shared global config (see the multi-user config direction) can override it via buildStatusSourceMap's
 * `freshnessDays` argument without touching this constant. */
export const JIRA_SYNC_FRESHNESS_DAYS = 7;

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

/** Confidence in the status/health signal behind a LOQ (A05). `confirmed` = either an unbound LOQ
 * (the plan is the authority) or a Jira-bound one whose last sync is fresh and whose status maps.
 * `unknown` = a Jira-bound LOQ we can't currently confirm (never synced, stale, or an unmapped
 * status). Health never asserts `on-track` from the mere absence of a variance when confidence is
 * `unknown` — it reads `unknown` instead. */
export type StatusConfidence = 'confirmed' | 'unknown';
export type StatusConfidenceResolver = (loq: Loq) => StatusConfidence;
const ALWAYS_CONFIRMED: StatusConfidenceResolver = () => 'confirmed';

/** Context for deriving health against a point in time with a confidence signal. `now` is the
 * injectable observation date (ISO yyyy-mm-dd) — defaults to today, overridden in tests for
 * determinism. `confidence` grades how much we trust the status/health (see StatusConfidence). */
export interface HealthContext {
  now?: string;
  confidence?: StatusConfidence;
}

/** Rollup-level context threaded through the cell/cinematic aggregates — a per-LOQ confidence
 * resolver plus the shared observation date. Both optional: omitting them reproduces the pre-A05
 * behaviour (every LOQ confirmed, observed today). */
export interface HealthRollupContext {
  confidenceOf?: StatusConfidenceResolver;
  now?: string;
}

/**
 * Health has no stored field anywhere in the schema — derived from the forecast slip the loq_at_risk
 * check uses (LoqForecast.deltaDays, threshold 5 = critical), the committed deadline against an
 * observation date, the LOQ's own paused flag, its (effective) status, and — for Jira-bound rows —
 * our confidence in that status (A05).
 *
 * Precedence, worst-threat-first so a voluntary pause never masks a real delivery threat (A05):
 *   1. involuntary `BLOCKED` → `blocked`;
 *   2. a breached committed deadline (committed finish before `now`, not terminal) → `late` — this is
 *      a factual, already-missed deadline, so it overrides a pause and a "no variance" calm;
 *   3. a voluntary pause → the calm `on-hold` (a derived forecast slip, where nobody is working the
 *      parked LOQ, yields to it; the hard threats above do not);
 *   4. terminal: `CUT` is neutral `on-track` (never "late"); `DONE` scores on the delivered delta;
 *   5. an active forecast slip → `late` (≥5) / `at-risk` (>0), an advance → `ahead`;
 *   6. otherwise the only signal is "no variance declared": `on-track` when confirmed, but `unknown`
 *      when we can't confirm a Jira-bound LOQ — absence of a variance alone never asserts On track.
 */
export function deriveLoqHealth(
  loq: Loq,
  forecast: LoqForecast | undefined,
  status: LoqStatus = loq.status,
  ctx: HealthContext = {},
): WatchtowerHealth {
  const now = ctx.now ?? localTodayIso();
  const confidence = ctx.confidence ?? 'confirmed';
  const delta = forecast?.deltaDays ?? 0;
  const terminal = status === 'DONE' || status === 'CUT';
  const committedFinish = forecast?.committedFinish ?? loqEffectiveFinish(loq);
  const overdue = !terminal && committedFinish != null && committedFinish < now;

  // Hard delivery threats first — a voluntary pause must never hide them (A05).
  if (status === 'BLOCKED') return 'blocked';
  if (overdue) return 'late';

  // Voluntary pause: a calm parked state, shown only once no hard threat applies.
  if (loq.paused) return 'on-hold';

  if (status === 'CUT') return 'on-track';
  if (status === 'DONE') {
    if (delta > 0) return 'late';
    if (delta < 0) return 'ahead';
    return 'on-track';
  }
  if (delta >= 5) return 'late';
  if (delta > 0) return 'at-risk';
  if (delta < 0) return 'ahead';
  // No slip, not overdue, not blocked, not done, not paused: the only signal is the absence of a
  // declared variance. For a Jira-bound LOQ we can't currently confirm, that is not proof of being on
  // track — surface the uncertainty (A05). An unbound LOQ or a fresh, mapped sync reads on-track.
  if (confidence === 'unknown') return 'unknown';
  return 'on-track';
}

/** Describes how trustworthy a Jira-bound LOQ's mirrored status currently is (A05), for both the
 * confidence resolver and the LOQ page's "status source / freshness" readout. Only Jira-bound LOQs
 * that have synced at least once appear in the source map; a bound LOQ that has never synced is
 * absent (statusConfidenceFrom reads that absence, via loq.jiraKey, as `unknown`). */
export interface JiraStatusSource {
  kind: 'jira-fresh' | 'jira-stale' | 'jira-unmapped';
  /** Jira's last sync timestamp (ISO), as reported by the sync state. */
  lastSyncedAt: string;
  /** Whole days from the last sync to the observation date (≥ 0). */
  ageDays: number;
}

/**
 * Per-LOQ freshness/mapping of the Jira-mirrored status, for every bound LOQ that has synced at least
 * once. `jira-fresh` = synced within the freshness window and the status maps; `jira-stale` = synced
 * but older than the window; `jira-unmapped` = synced but the raw status isn't covered by the mapping.
 * Built on read (derive, never store), mirroring buildEffectiveStatusMap.
 */
export function buildStatusSourceMap(
  engine: PlanningEngine,
  configs: JiraProjectConfig[],
  now: string = localTodayIso(),
  freshnessDays: number = JIRA_SYNC_FRESHNESS_DAYS,
): Map<string, JiraStatusSource> {
  const mappingByProject = new Map(configs.map((c) => [c.projectId, c.statusMapping]));
  const result = new Map<string, JiraStatusSource>();
  for (const { loq, state } of engine.loqsWithJiraSync()) {
    if (!loq.jiraKey) continue;
    const cinematic = engine.cinematic(loq.cinematicId);
    const mapping = cinematic ? mappingByProject.get(cinematic.projectId) ?? null : null;
    const ageDays = Math.max(0, isoDiffDays(state.lastSyncedAt.slice(0, 10), now));
    let kind: JiraStatusSource['kind'];
    if (resolveJiraStatus(state.jiraStatus, mapping) === null) kind = 'jira-unmapped';
    else if (ageDays > freshnessDays) kind = 'jira-stale';
    else kind = 'jira-fresh';
    result.set(loq.id, { kind, lastSyncedAt: state.lastSyncedAt, ageDays });
  }
  return result;
}

/** Turns a status-source map into a per-LOQ confidence resolver (A05). An unbound LOQ (no jiraKey)
 * is `confirmed` — the plan is its authority. A bound LOQ is `confirmed` only when its source is
 * `jira-fresh`; a stale/unmapped source, or a bound LOQ absent from the map (never synced), is
 * `unknown`. A null map confirms everything (callers that don't cross with Jira). */
export function statusConfidenceFrom(sources: ReadonlyMap<string, JiraStatusSource> | null | undefined): StatusConfidenceResolver {
  if (!sources) return ALWAYS_CONFIRMED;
  return (loq) => {
    if (!loq.jiraKey) return 'confirmed';
    const src = sources.get(loq.id);
    if (!src) return 'unknown'; // bound but never synced
    return src.kind === 'jira-fresh' ? 'confirmed' : 'unknown';
  };
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

/**
 * Every involuntarily-BLOCKED LOQ in a (Cinematic, discipline) cell — the siblings a single
 * representative LOQ can hide (bug A06: an in-progress representative masked a blocked sibling, so
 * the cell read on-track and the block was neither visible nor openable). The representative stays
 * whatever representativeLoq picks; this scans *all* milestones in the cell so blocking can be
 * surfaced and the blocked LOQ opened directly. A voluntary pause is a calm hold, not an involuntary
 * block (it reads `on-hold`, see deriveLoqHealth), so paused rows are excluded; a terminal
 * (DONE/CUT) — or deleted — milestone never counts as an active block, so finished/removed work
 * raises no false alarm.
 */
export function cellBlockedLoqs(
  loqs: Loq[],
  cinematicId: string,
  disciplineId: string,
  statusOf: StatusResolver = OWN_STATUS,
): Loq[] {
  return loqs.filter(
    (l) =>
      l.cinematicId === cinematicId &&
      l.disciplineId === disciplineId &&
      !l.paused &&
      statusOf(l) === 'BLOCKED',
  );
}

/**
 * Health of a (Cinematic, discipline) cell: the representative LOQ's own health, raised to `blocked`
 * when any sibling in the cell is involuntarily blocked (A06). This keeps the representative as the
 * cell's displayed milestone while making the alert span *all* its milestones, so a block hidden
 * behind an in-progress representative still colours the cell and rolls up. Null when the cell has no
 * LOQ at all.
 */
export function cellHealth(
  loqs: Loq[],
  cinematicId: string,
  disciplineId: string,
  forecasts: ReadonlyMap<string, LoqForecast>,
  statusOf: StatusResolver = OWN_STATUS,
  ctx: HealthRollupContext = {},
): WatchtowerHealth | null {
  const rep = representativeLoq(loqs, cinematicId, disciplineId, statusOf);
  if (!rep) return null;
  const repHealth = deriveLoqHealth(rep, forecasts.get(rep.id), statusOf(rep), {
    now: ctx.now,
    confidence: ctx.confidenceOf?.(rep),
  });
  if (cellBlockedLoqs(loqs, cinematicId, disciplineId, statusOf).length === 0) return repHealth;
  return HEALTH_SEVERITY[repHealth] >= HEALTH_SEVERITY.blocked ? repHealth : 'blocked';
}

/** Worst health across every discipline that has a representative LOQ for this Cinematic. Null when
 * the Cinematic has no LOQs at all yet. */
export function cinematicHealth(
  cinematicId: string,
  disciplineIds: string[],
  loqs: Loq[],
  forecasts: ReadonlyMap<string, LoqForecast>,
  statusOf: StatusResolver = OWN_STATUS,
  ctx: HealthRollupContext = {},
): WatchtowerHealth | null {
  let worst: WatchtowerHealth | null = null;
  for (const disciplineId of disciplineIds) {
    const health = cellHealth(loqs, cinematicId, disciplineId, forecasts, statusOf, ctx);
    if (health === null) continue;
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
  // A06: a BLOCKED sibling hidden behind an in-progress representative is still a real block — make
  // it dominate the rollup (BLOCKED is top priority) rather than let the representative mask it.
  if (disciplineIds.some((d) => cellBlockedLoqs(loqs, cinematicId, d, statusOf).length > 0)) present.add('BLOCKED');
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
  ctx: HealthRollupContext = {},
): string | null {
  let worstId: string | null = null;
  let worstHealth: WatchtowerHealth | null = null;
  for (const disciplineId of disciplineIds) {
    const health = cellHealth(loqs, cinematicId, disciplineId, forecasts, statusOf, ctx);
    if (health === null) continue;
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
  ctx: HealthRollupContext = {},
): Record<WatchtowerHealth, number> {
  const counts: Record<WatchtowerHealth, number> = { ahead: 0, 'on-track': 0, 'on-hold': 0, unknown: 0, 'at-risk': 0, late: 0, blocked: 0 };
  for (const cinematic of cinematics) {
    const health = cinematicHealth(cinematic.id, disciplineIds, loqs, forecasts, statusOf, ctx);
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
  return 'Watchtower'; // loq_at_risk / loq_overdue / loq_root_cause / loq_early_opportunity / loq_dependency_contradiction / invalid_dates / tbd_dates
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
