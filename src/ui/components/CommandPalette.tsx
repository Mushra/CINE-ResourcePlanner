import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { Icon, type IconName } from './Icon';
import { isGenericPoolName } from '../../domain/identity';
import { UNASSIGNED_DISCIPLINE_ID } from '../../engine/planning';

interface PaletteItem {
  id: string;
  type: 'project' | 'person' | 'role' | 'discipline';
  icon: IconName;
  label: string;
  sublabel?: string;
  onSelect: () => void;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const navigate = useUiStore((s) => s.navigate);
  const openProject = useUiStore((s) => s.openProject);
  const globalFilter = useUiStore((s) => s.globalFilter);
  const setGlobalFilter = useUiStore((s) => s.setGlobalFilter);
  const setCollapsed = useUiStore((s) => s.setCollapsed);

  const projects = useStore((s) => s.data.projects);
  const people = useStore((s) => s.data.people);
  const pools = useStore((s) => s.data.pools);
  const disciplines = useStore((s) => s.data.disciplines);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const poolById = useMemo(() => new Map(pools.map((p) => [p.id, p])), [pools]);
  const disciplineById = useMemo(() => new Map(disciplines.map((d) => [d.id, d])), [disciplines]);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    for (const project of projects) {
      list.push({
        id: `project:${project.id}`,
        type: 'project',
        icon: 'projects',
        label: project.name,
        sublabel: 'Project',
        onSelect: () => openProject(project.id),
      });
    }

    for (const discipline of disciplines) {
      list.push({
        id: `discipline:${discipline.id}`,
        type: 'discipline',
        icon: 'structure',
        label: discipline.name,
        sublabel: 'Discipline',
        onSelect: () => {
          navigate('team');
          setGlobalFilter({ ...globalFilter, disciplineIds: [discipline.id] });
          setCollapsed(`team:disc:${discipline.id}`, false);
        },
      });
    }

    for (const pool of pools) {
      if (isGenericPoolName(pool.name)) continue;
      const disciplineId = pool.disciplineId ?? UNASSIGNED_DISCIPLINE_ID;
      const discipline = pool.disciplineId ? disciplineById.get(pool.disciplineId) : null;
      list.push({
        id: `role:${pool.id}`,
        type: 'role',
        icon: 'team',
        label: pool.name,
        sublabel: discipline ? `Role — ${discipline.name}` : 'Role — Unassigned',
        onSelect: () => {
          navigate('team');
          setGlobalFilter({ ...globalFilter, disciplineIds: [disciplineId] });
          setCollapsed(`team:disc:${disciplineId}`, false);
          setCollapsed(`team:pool:${pool.id}`, false);
        },
      });
    }

    for (const person of people) {
      const pool = person.poolId ? poolById.get(person.poolId) : null;
      const disciplineId = pool?.disciplineId ?? UNASSIGNED_DISCIPLINE_ID;
      list.push({
        id: `person:${person.id}`,
        type: 'person',
        icon: 'team',
        label: person.name,
        sublabel: pool ? `Person — ${pool.name}` : 'Person — Unassigned',
        onSelect: () => {
          navigate('team');
          setGlobalFilter({ ...globalFilter, disciplineIds: [disciplineId] });
          setCollapsed(`team:disc:${disciplineId}`, false);
          if (pool) setCollapsed(`team:pool:${pool.id}`, false);
        },
      });
    }

    return list;
  }, [projects, disciplines, pools, people, poolById, disciplineById, openProject, navigate, globalFilter, setGlobalFilter, setCollapsed]);

  if (!open) return null;

  return <CommandPalettePanel items={items} onClose={() => setOpen(false)} />;
}

function CommandPalettePanel({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((item) => item.label.toLowerCase().includes(q) || item.sublabel?.toLowerCase().includes(q)).slice(0, 50);
  }, [items, query]);

  function select(item: PaletteItem): void {
    item.onSelect();
    onClose();
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Jump to a project, person, role, or discipline…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const item = filtered[activeIndex];
                if (item) select(item);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {filtered.length === 0 && <div className="palette-empty">No matches</div>}
          {filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`palette-item ${index === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(item)}
            >
              <Icon name={item.icon} size={14} />
              <span className="palette-item-label">{item.label}</span>
              {item.sublabel && <span className="palette-item-sub">{item.sublabel}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
