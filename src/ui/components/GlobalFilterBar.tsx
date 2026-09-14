import { useUiStore } from '../../store/useUiStore';
import { isGlobalFilterActive } from '../../domain/filter';
import { FilterMenu } from './FilterMenu';
import { Button } from './Button';
import type { GlobalFilterOptions } from '../hooks/useFilteredEngine';

/**
 * Shared filter bar for Dashboard/Team/People: Site/Team/Discipline narrow which
 * people and pools the engine sees (see useFilteredEngine). One filter, every view that renders
 * this bar reacts the same way.
 */
export function GlobalFilterBar({ options }: { options: GlobalFilterOptions }) {
  const globalFilter = useUiStore((s) => s.globalFilter);
  const setGlobalFilter = useUiStore((s) => s.setGlobalFilter);

  const isActive = isGlobalFilterActive(globalFilter);

  return (
    <div className="global-filter-bar">
      <FilterMenu
        label="Site"
        options={options.siteOptions}
        activeIds={globalFilter.sites ? new Set(globalFilter.sites) : null}
        onChange={(next) => setGlobalFilter({ ...globalFilter, sites: next ? [...next] : null })}
      />
      <FilterMenu
        label="Team"
        options={options.teamOptions}
        activeIds={globalFilter.teams ? new Set(globalFilter.teams) : null}
        onChange={(next) => setGlobalFilter({ ...globalFilter, teams: next ? [...next] : null })}
      />
      <FilterMenu
        label="Discipline"
        options={options.disciplineOptions}
        activeIds={globalFilter.disciplineIds ? new Set(globalFilter.disciplineIds) : null}
        onChange={(next) => setGlobalFilter({ ...globalFilter, disciplineIds: next ? [...next] : null })}
      />
      {isActive && (
        <Button variant="ghost" size="sm" onClick={() => setGlobalFilter({ sites: null, teams: null, disciplineIds: null })}>
          Clear
        </Button>
      )}
    </div>
  );
}
