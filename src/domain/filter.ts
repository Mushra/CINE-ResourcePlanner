// A pure, DB/UI-free filter over a PlanningData snapshot. Selecting a Site/Team/Discipline doesn't
// just hide rows — it recomputes: the caller builds a new PlanningEngine over the filtered subset,
// so capacity/occupation figures reflect only the selected slice. Requirements stay pool-level
// (there's no site/team on demand), so a Site/Team filter narrows supply but not the pool-level
// requirement figures it's compared against — an accepted limitation, not a bug.
import type { PlanningData } from './types';

/** Sentinel id for "no team set", used as a FilterMenu option id alongside real team names. */
export const NO_TEAM_KEY = '__no_team__';
/** Sentinel id for "no site set", used as a FilterMenu option id alongside real site names. */
export const NO_SITE_KEY = '__no_site__';
/** Must match UNASSIGNED_DISCIPLINE_ID in engine/planning.ts — the "no discipline" pool bucket. */
const UNASSIGNED_DISCIPLINE_KEY = '__unassigned__';

export interface GlobalFilter {
  /** Person.site values, '' represented by NO_SITE_KEY. null = no filter (everyone matches). */
  sites: string[] | null;
  /** Person.team values, '' represented by NO_TEAM_KEY. null = no filter (everyone matches). */
  teams: string[] | null;
  /** Discipline ids, null disciplineId represented by UNASSIGNED_DISCIPLINE_ID. null = no filter. */
  disciplineIds: string[] | null;
}

export const EMPTY_GLOBAL_FILTER: GlobalFilter = { sites: null, teams: null, disciplineIds: null };

export function isGlobalFilterActive(f: GlobalFilter): boolean {
  return f.sites !== null || f.teams !== null || f.disciplineIds !== null;
}

function matchesKeyedSet(value: string, sentinel: string, set: string[] | null): boolean {
  if (!set) return true;
  return set.includes(value.trim() ? value : sentinel);
}

/**
 * Filters people by Site/Team, and pools/disciplines by Discipline, cascading the removal to every
 * row that references an excluded person or pool (requirements, assignments, their allocations).
 * Returns `data` unchanged when no filter is active.
 */
export function filterPlanningData(data: PlanningData, filter: GlobalFilter): PlanningData {
  if (!isGlobalFilterActive(filter)) return data;

  const pools = filter.disciplineIds
    ? data.pools.filter((p) => filter.disciplineIds!.includes(p.disciplineId ?? UNASSIGNED_DISCIPLINE_KEY))
    : data.pools;
  const poolIds = new Set(pools.map((p) => p.id));
  const disciplines = filter.disciplineIds
    ? data.disciplines.filter((d) => filter.disciplineIds!.includes(d.id))
    : data.disciplines;

  const people = data.people.filter((p) => {
    if (!matchesKeyedSet(p.site, NO_SITE_KEY, filter.sites)) return false;
    if (!matchesKeyedSet(p.team, NO_TEAM_KEY, filter.teams)) return false;
    if (filter.disciplineIds && p.poolId !== null && !poolIds.has(p.poolId)) return false;
    return true;
  });
  const peopleIds = new Set(people.map((p) => p.id));

  const requirements = filter.disciplineIds ? data.requirements.filter((r) => poolIds.has(r.poolId)) : data.requirements;
  const requirementIds = new Set(requirements.map((r) => r.id));
  const requirementAllocations = filter.disciplineIds
    ? data.requirementAllocations.filter((a) => requirementIds.has(a.requirementId))
    : data.requirementAllocations;

  const personAssignments = data.personAssignments.filter((pa) => peopleIds.has(pa.personId));
  const personAssignmentIds = new Set(personAssignments.map((pa) => pa.id));
  const personAssignmentAllocations = data.personAssignmentAllocations.filter((a) => personAssignmentIds.has(a.personAssignmentId));

  return { ...data, disciplines, pools, people, requirements, requirementAllocations, personAssignments, personAssignmentAllocations };
}
