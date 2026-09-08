import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResourcePool } from '../../domain/types';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';

/**
 * Excel-style "filter by column values" popover for the Timeline's pool filter — a search box
 * plus a checkbox list (grouped by discipline) with select-all/clear, replacing the old chip row.
 */
export function PoolFilterMenu({
  pools, disciplineName, activePoolIds, onChange,
}: {
  pools: ResourcePool[];
  disciplineName: (pool: ResourcePool) => string;
  activePoolIds: Set<string>;
  onChange: (next: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const filtered = useMemo(
    () => pools.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [pools, query],
  );
  const groups = useMemo(() => {
    const byDiscipline = new Map<string, ResourcePool[]>();
    for (const pool of filtered) {
      const name = disciplineName(pool);
      if (!byDiscipline.has(name)) byDiscipline.set(name, []);
      byDiscipline.get(name)!.push(pool);
    }
    return [...byDiscipline.entries()];
  }, [filtered, disciplineName]);

  const isFiltered = activePoolIds.size < pools.length;
  const allIds = useMemo(() => pools.map((p) => p.id), [pools]);

  function toggle(poolId: string): void {
    const next = new Set(activePoolIds);
    if (next.has(poolId)) next.delete(poolId); else next.add(poolId);
    onChange(next.size === allIds.length ? null : next);
  }

  return (
    <div className="pool-filter-menu" ref={ref}>
      <Button
        variant={isFiltered ? 'primary' : 'secondary'}
        size="sm"
        icon="filter"
        onClick={() => setOpen((v) => !v)}
      >
        Filtrer par métier{isFiltered ? ` (${activePoolIds.size})` : ''}
      </Button>
      {open && (
        <div className="pool-filter-popover">
          <div className="pool-filter-search">
            <Icon name="search" size={12} />
            <input autoFocus placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="pool-filter-actions">
            <button type="button" onClick={() => onChange(null)}>Tout sélectionner</button>
            <button type="button" onClick={() => onChange(new Set())}>Effacer</button>
          </div>
          <div className="pool-filter-list">
            {groups.length === 0 && <p className="empty-inline">No match</p>}
            {groups.map(([discName, groupPools]) => (
              <div key={discName} className="pool-filter-group">
                <div className="pool-filter-group-name">{discName}</div>
                {groupPools.map((pool) => (
                  <label key={pool.id} className="pool-filter-item">
                    <input type="checkbox" checked={activePoolIds.has(pool.id)} onChange={() => toggle(pool.id)} />
                    <span className="pool-dot" style={{ background: pool.color }} />
                    {pool.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
