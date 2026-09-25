import { useState } from 'react';
import { useStore } from '../../../store/useStore';
import { useUiStore, type MatrixGroupBy } from '../../../store/useUiStore';
import {
  CINEMATIC_STATUS_LABEL, HEALTH_LABEL, HEALTH_ORDER, cinematicHealth, cinematicStatus, loqStatusLabel,
  representativeLoq, worstDiscipline, type CinematicOverallStatus,
} from '../../../engine/watchtower';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { FilterMenu, type FilterOption } from '../../components/FilterMenu';
import { CinematicFormDrawer, type CinematicFormValue } from '../../components/CinematicFormDrawer';
import { MppImportDrawer } from '../../components/MppImportDrawer';
import { JiraBindingDrawer } from '../../components/JiraBindingDrawer';
import type { Cinematic, Project } from '../../../domain/types';
import type { SanityCheck } from '../../../engine/validation';

const STATUS_ORDER: CinematicOverallStatus[] = ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'DONE'];
const NO_LOQS_KEY = '__none__';

type SortCol = 'name' | 'health' | string;

/**
 * Watchtower's Production → Cinematics Matrix: one row per Cinematic, one column per discipline
 * (the representative LOQ, see engine/watchtower.ts::representativeLoq), with the search/group/
 * columns/sort/filter toolbar from the prototype. Also hosts cinematic creation (New / Import .mpp /
 * Sync with Jira) — migrated here from the old Cinematics card since this is now the cinematics list.
 */
export function CinematicsMatrix({ project, checks }: { project: Project; checks: SanityCheck[] }) {
  const engine = useStore((s) => s.engine);
  const disciplines = useStore((s) => s.data.disciplines);
  const allCinematics = useStore((s) => s.data.cinematics);
  const allLoqs = useStore((s) => s.data.loqs);
  const createCinematic = useStore((s) => s.createCinematic);
  const openCinematic = useUiStore((s) => s.openCinematic);
  const groupBy = useUiStore((s) => s.matrixGroupBy);
  const setGroupBy = useUiStore((s) => s.setMatrixGroupBy);
  const hiddenDisciplineIds = useUiStore((s) => s.matrixHiddenDisciplineIds);
  const setHiddenDisciplineIds = useUiStore((s) => s.setMatrixHiddenDisciplineIds);

  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<Set<string> | null>(null);
  const [disciplineFilter, setDisciplineFilter] = useState<Set<string> | null>(null);
  const [levelFilter, setLevelFilter] = useState<Set<string> | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<string> | null>(null);
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [newCinematic, setNewCinematic] = useState(false);
  const [importingMpp, setImportingMpp] = useState(false);
  const [syncingJira, setSyncingJira] = useState(false);

  const cinematics = allCinematics.filter((c) => c.projectId === project.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const cinematicIds = new Set(cinematics.map((c) => c.id));
  const loqs = allLoqs.filter((l) => cinematicIds.has(l.cinematicId));
  const usedDisciplineIds = disciplines.filter((d) => loqs.some((l) => l.disciplineId === d.id)).map((d) => d.id);
  const visibleDisciplineIds = usedDisciplineIds.filter((id) => !hiddenDisciplineIds.includes(id));
  const disciplineName = (id: string) => disciplines.find((d) => d.id === id)?.name ?? id;
  const forecasts = engine.getLoqForecasts();
  const levels = [...new Set(loqs.map((l) => l.type))].sort();
  const attentionCountByCinematic = new Map<string, number>();
  for (const check of checks) {
    if (!check.loqId) continue;
    const loq = engine.loq(check.loqId);
    if (loq) attentionCountByCinematic.set(loq.cinematicId, (attentionCountByCinematic.get(loq.cinematicId) ?? 0) + 1);
  }

  function passesFilters(cinematic: Cinematic): boolean {
    if (search && !cinematic.name.toLowerCase().includes(search.toLowerCase())) return false;
    const health = cinematicHealth(cinematic.id, usedDisciplineIds, loqs, forecasts);
    if (healthFilter && !(health && healthFilter.has(health))) return false;
    if (disciplineFilter) {
      const hasAny = usedDisciplineIds.some((id) => disciplineFilter.has(id) && representativeLoq(loqs, cinematic.id, id));
      if (!hasAny) return false;
    }
    if (levelFilter) {
      const hasAny = usedDisciplineIds.some((id) => {
        const loq = representativeLoq(loqs, cinematic.id, id);
        return loq && levelFilter.has(loq.type);
      });
      if (!hasAny) return false;
    }
    if (statusFilter) {
      const status = cinematicStatus(cinematic.id, usedDisciplineIds, loqs);
      if (!(status && statusFilter.has(status))) return false;
    }
    return true;
  }

  function sortRows(rows: Cinematic[]): Cinematic[] {
    const mul = sort.dir === 'asc' ? 1 : -1;
    if (sort.col === 'name') return [...rows].sort((a, b) => mul * a.name.localeCompare(b.name));
    if (sort.col === 'health') {
      return [...rows].sort((a, b) => {
        const ah = cinematicHealth(a.id, usedDisciplineIds, loqs, forecasts);
        const bh = cinematicHealth(b.id, usedDisciplineIds, loqs, forecasts);
        const ai = ah ? HEALTH_ORDER.indexOf(ah) : HEALTH_ORDER.length;
        const bi = bh ? HEALTH_ORDER.indexOf(bh) : HEALTH_ORDER.length;
        return mul * (ai - bi);
      });
    }
    const disciplineId = sort.col;
    const withLoq = rows.filter((c) => representativeLoq(loqs, c.id, disciplineId));
    const withoutLoq = rows.filter((c) => !representativeLoq(loqs, c.id, disciplineId));
    withLoq.sort((a, b) => mul * (representativeLoq(loqs, a.id, disciplineId)!.type.localeCompare(representativeLoq(loqs, b.id, disciplineId)!.type)));
    return [...withLoq, ...withoutLoq];
  }

  function onSort(col: SortCol): void {
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  }

  const filteredRows = cinematics.filter(passesFilters);

  function groupKeyAndLabel(cinematic: Cinematic): { key: string; label: string } {
    if (groupBy === 'health') {
      const h = cinematicHealth(cinematic.id, usedDisciplineIds, loqs, forecasts);
      return h ? { key: h, label: HEALTH_LABEL[h] } : { key: NO_LOQS_KEY, label: 'No LOQs yet' };
    }
    if (groupBy === 'status') {
      const s = cinematicStatus(cinematic.id, usedDisciplineIds, loqs);
      return s ? { key: s, label: CINEMATIC_STATUS_LABEL[s] } : { key: NO_LOQS_KEY, label: 'No LOQs yet' };
    }
    // discipline
    const worst = worstDiscipline(cinematic.id, usedDisciplineIds, loqs, forecasts);
    return worst ? { key: worst, label: disciplineName(worst) } : { key: NO_LOQS_KEY, label: 'No LOQs yet' };
  }

  const groups: { key: string; label: string; rows: Cinematic[] }[] = [];
  if (groupBy !== 'none') {
    const byKey = new Map<string, { key: string; label: string; rows: Cinematic[] }>();
    for (const cinematic of filteredRows) {
      const { key, label } = groupKeyAndLabel(cinematic);
      if (!byKey.has(key)) byKey.set(key, { key, label, rows: [] });
      byKey.get(key)!.rows.push(cinematic);
    }
    const order = groupBy === 'health' ? HEALTH_ORDER as string[] : groupBy === 'status' ? STATUS_ORDER as string[] : null;
    const keys = [...byKey.keys()].sort((a, b) => {
      if (order) {
        const ai = a === NO_LOQS_KEY ? order.length : order.indexOf(a);
        const bi = b === NO_LOQS_KEY ? order.length : order.indexOf(b);
        return ai - bi;
      }
      if (a === NO_LOQS_KEY) return 1;
      if (b === NO_LOQS_KEY) return -1;
      return byKey.get(a)!.label.localeCompare(byKey.get(b)!.label);
    });
    for (const key of keys) groups.push(byKey.get(key)!);
  }

  const healthOptions: FilterOption[] = HEALTH_ORDER.map((h) => ({ id: h, label: HEALTH_LABEL[h] }));
  const disciplineOptions: FilterOption[] = usedDisciplineIds.map((id) => ({ id, label: disciplineName(id), color: disciplines.find((d) => d.id === id)?.color }));
  const levelOptions: FilterOption[] = levels.map((l) => ({ id: l, label: l }));
  const statusOptions: FilterOption[] = STATUS_ORDER.map((s) => ({ id: s, label: CINEMATIC_STATUS_LABEL[s] }));
  const columnOptions: FilterOption[] = usedDisciplineIds.map((id) => ({ id, label: disciplineName(id), color: disciplines.find((d) => d.id === id)?.color }));
  const visibleColumnIds = usedDisciplineIds.filter((id) => !hiddenDisciplineIds.includes(id));

  function sortIndicator(col: SortCol) {
    if (sort.col !== col) return null;
    return <Icon name={sort.dir === 'asc' ? 'chevron-down' : 'chevron-right'} size={11} />;
  }

  function renderRow(cinematic: Cinematic) {
    const health = cinematicHealth(cinematic.id, usedDisciplineIds, loqs, forecasts);
    const issueCount = attentionCountByCinematic.get(cinematic.id) ?? 0;
    return (
      <tr key={cinematic.id}>
        <td className="mx-cin-col">
          <button type="button" className="mx-cin-name" onClick={() => openCinematic(cinematic.id)}>{cinematic.name}</button>
        </td>
        <td>
          <div className="mx-health-cell">
            <span className={`health-text health-text-${health ?? 'on-track'}`}>{health ? HEALTH_LABEL[health].toUpperCase() : '—'}</span>
            {issueCount > 0 && <span className="mx-health-issues">{issueCount} issue{issueCount > 1 ? 's' : ''}</span>}
          </div>
        </td>
        {visibleDisciplineIds.map((disciplineId) => {
          const loq = representativeLoq(loqs, cinematic.id, disciplineId);
          if (!loq) return <td key={disciplineId} className="mx-na">N/A</td>;
          return (
            <td key={disciplineId} className="mx-cell" onClick={() => openCinematic(cinematic.id)}>
              <div className="mx-cell-level">{loq.type}</div>
              <div className={`mx-cell-status loq-status loq-status-${loq.status.toLowerCase()}`}>{loqStatusLabel(loq)}</div>
            </td>
          );
        })}
      </tr>
    );
  }

  const colSpan = 2 + visibleDisciplineIds.length;

  return (
    <div className="card panel">
      <div className="panel-header">
        <h2>Cinematics</h2>
        <span className="panel-sub">{cinematics.length} cinematic{cinematics.length === 1 ? '' : 's'} in this project</span>
        <div className="panel-header-toggles">
          <Button variant="secondary" size="sm" icon="file-plus" onClick={() => setImportingMpp(true)}>Import .mpp</Button>
          <Button variant="secondary" size="sm" icon="link" onClick={() => setSyncingJira(true)}>Sync with Jira</Button>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setNewCinematic(true)}>New cinematic</Button>
        </div>
      </div>

      <div className="matrix-toolbar">
        <input type="text" placeholder="Search cinematic name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <FilterMenu label="Health" options={healthOptions} activeIds={healthFilter} onChange={setHealthFilter} />
        <FilterMenu label="Discipline" options={disciplineOptions} activeIds={disciplineFilter} onChange={setDisciplineFilter} />
        <FilterMenu label="LOQ level" options={levelOptions} activeIds={levelFilter} onChange={setLevelFilter} />
        <FilterMenu label="Status" options={statusOptions} activeIds={statusFilter} onChange={setStatusFilter} />
        <div className="matrix-toolbar-spacer" />
        <select className="matrix-group-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value as MatrixGroupBy)}>
          <option value="none">Group by: None</option>
          <option value="health">Group by: Health</option>
          <option value="status">Group by: Status</option>
          <option value="discipline">Group by: Discipline</option>
        </select>
        <FilterMenu
          label="Columns"
          icon="table"
          options={columnOptions}
          activeIds={visibleColumnIds.length === usedDisciplineIds.length ? null : new Set(visibleColumnIds)}
          onChange={(next) => setHiddenDisciplineIds(next === null ? [] : usedDisciplineIds.filter((id) => !next.has(id)))}
        />
      </div>

      {cinematics.length === 0 ? (
        <p className="empty-inline">No cinematics yet. Add one to start scheduling LOQs.</p>
      ) : (
        <div className="matrix-wrap">
          <table className="mx-table">
            <thead>
              <tr>
                <th className="mx-cin-col" onClick={() => onSort('name')}>CIN {sortIndicator('name')}</th>
                <th onClick={() => onSort('health')}>Health {sortIndicator('health')}</th>
                {visibleDisciplineIds.map((id) => (
                  <th key={id} onClick={() => onSort(id)}>{disciplineName(id)} {sortIndicator(id)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr className="mx-empty-row"><td colSpan={colSpan}>No cinematics match your filters.</td></tr>
              ) : groupBy === 'none' ? (
                sortRows(filteredRows).map(renderRow)
              ) : (
                groups.flatMap((group) => {
                  const collapsed = collapsedGroups.has(group.key);
                  const headerRow = (
                    <tr
                      key={`group:${group.key}`}
                      className="mx-group-row"
                      onClick={() => setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                        return next;
                      })}
                    >
                      <td colSpan={colSpan}>
                        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} /> {group.label} · {group.rows.length} CIN
                      </td>
                    </tr>
                  );
                  return collapsed ? [headerRow] : [headerRow, ...sortRows(group.rows).map(renderRow)];
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {newCinematic && (
        <CinematicFormDrawer
          onClose={() => setNewCinematic(false)}
          onSave={(value: CinematicFormValue) => {
            createCinematic({ projectId: project.id, ...value });
            setNewCinematic(false);
          }}
        />
      )}

      {importingMpp && (
        <MppImportDrawer projectId={project.id} projectName={project.name} onClose={() => setImportingMpp(false)} />
      )}

      {syncingJira && (
        <JiraBindingDrawer projectId={project.id} projectName={project.name} onClose={() => setSyncingJira(false)} />
      )}
    </div>
  );
}
