import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';

export interface FilterOption {
  id: string;
  label: string;
  color?: string;
  /** Optional group heading (e.g. discipline name) — options are clustered under it when present. */
  group?: string;
}

/**
 * Excel-style "filter by column values" popover: a search box plus a checkbox list (optionally
 * grouped) with select-all/clear. `activeIds === null` means "everything selected" (no filter).
 */
export function FilterMenu({
  label, icon = 'filter', options, activeIds, onChange,
}: {
  label: string;
  icon?: IconName;
  options: FilterOption[];
  activeIds: Set<string> | null;
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
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );
  const groups = useMemo(() => {
    const byGroup = new Map<string, FilterOption[]>();
    for (const option of filtered) {
      const key = option.group ?? '';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(option);
    }
    return [...byGroup.entries()];
  }, [filtered]);

  const active = activeIds ?? new Set(options.map((o) => o.id));
  const isFiltered = active.size < options.length;
  const allIds = useMemo(() => options.map((o) => o.id), [options]);

  function toggle(id: string): void {
    const next = new Set(active);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next.size === allIds.length ? null : next);
  }

  return (
    <div className="filter-menu" ref={ref}>
      <Button
        variant={isFiltered ? 'primary' : 'secondary'}
        size="sm"
        icon={icon}
        onClick={() => setOpen((v) => !v)}
      >
        {label}{isFiltered ? ` (${active.size})` : ''}
      </Button>
      {open && (
        <div className="filter-popover">
          <div className="filter-search">
            <Icon name="search" size={12} />
            <input autoFocus placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="filter-actions">
            <button type="button" onClick={() => onChange(null)}>Select all</button>
            <button type="button" onClick={() => onChange(new Set())}>Clear</button>
          </div>
          <div className="filter-list">
            {groups.length === 0 && <p className="empty-inline">No match</p>}
            {groups.map(([groupName, groupOptions]) => (
              <div key={groupName || '_'} className="filter-group">
                {groupName && <div className="filter-group-name">{groupName}</div>}
                {groupOptions.map((option) => (
                  <label key={option.id} className="filter-item">
                    <input type="checkbox" checked={active.has(option.id)} onChange={() => toggle(option.id)} />
                    {option.color && <span className="pool-dot" style={{ background: option.color }} />}
                    {option.label}
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
