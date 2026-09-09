import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { BASE_SCENARIO_ID } from '../../db/repository';
import { PlanningEngine, UNASSIGNED_DISCIPLINE_ID } from '../../engine/planning';
import { filterPlanningData, NO_SITE_KEY, NO_TEAM_KEY } from '../../domain/filter';
import type { FilterOption } from '../components/FilterMenu';

/** Distinct Site/Team/Discipline options for the GlobalFilterBar, always computed on the full plan
 * so picking a filter never makes the menus that build it shrink. */
export interface GlobalFilterOptions {
  siteOptions: FilterOption[];
  teamOptions: FilterOption[];
  disciplineOptions: FilterOption[];
}

/**
 * Rebuilds a PlanningEngine over the subset of the plan matching the shared global filter
 * (Site/Team/Discipline). Capacity/occupation figures recompute for the filtered slice — see
 * domain/filter.ts for exactly what's included in that recomputation.
 */
export function useFilteredEngine(): { engine: PlanningEngine; options: GlobalFilterOptions } {
  const data = useStore((s) => s.data);
  const globalFilter = useUiStore((s) => s.globalFilter);

  const engine = useMemo(() => {
    const filtered = filterPlanningData(data, globalFilter);
    return new PlanningEngine(filtered, BASE_SCENARIO_ID);
  }, [data, globalFilter]);

  const options = useMemo<GlobalFilterOptions>(() => {
    const siteOptions: FilterOption[] = [...new Set(data.people.map((p) => p.site).filter((s) => s.trim().length > 0))]
      .sort()
      .map((s) => ({ id: s, label: s }));
    if (data.people.some((p) => !p.site.trim())) siteOptions.unshift({ id: NO_SITE_KEY, label: 'No site' });

    const teamOptions: FilterOption[] = [...new Set(data.people.map((p) => p.team).filter((t) => t.trim().length > 0))]
      .sort()
      .map((t) => ({ id: t, label: t }));
    if (data.people.some((p) => !p.team.trim())) teamOptions.unshift({ id: NO_TEAM_KEY, label: 'No team' });

    const disciplineOptions: FilterOption[] = data.disciplines.map((d) => ({ id: d.id, label: d.name, color: d.color }));
    if (data.pools.some((p) => p.disciplineId === null)) {
      disciplineOptions.push({ id: UNASSIGNED_DISCIPLINE_ID, label: 'Unassigned', color: '#9ca3af' });
    }

    return { siteOptions, teamOptions, disciplineOptions };
  }, [data.people, data.disciplines, data.pools]);

  return { engine, options };
}
