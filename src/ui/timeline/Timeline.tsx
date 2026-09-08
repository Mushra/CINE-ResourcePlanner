import { Fragment, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { buildTimelineWindow, monthWidthPx, totalWindowWidth, xForIsoDate } from './timelineMath';
import { formatPeriodLabel, todayPeriod } from '../../domain/periods';
import { ProjectBar } from './ProjectBar';
import { AllocationCell, formatNum, hexToRgba } from './AllocationCell';
import { UnscheduledPanel } from './UnscheduledPanel';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ProjectFormDrawer, type ProjectFormValue } from '../components/ProjectFormDrawer';
import { PoolFilterMenu } from './PoolFilterMenu';
import { round2, UNASSIGNED_DISCIPLINE_ID } from '../../engine/planning';
import { isGenericPoolName } from '../../domain/identity';
import type { TimelineZoom } from '../../store/useUiStore';
import type { PlanningEngine } from '../../engine/planning';
import type { Period } from '../../domain/types';

/** Read-only aggregate cell for a discipline's total — styled like AllocationCell but never opens an editor. */
function DisciplineCell({
  width, required, assigned, capacity, color, overCapacity,
}: {
  width: number;
  required: number;
  assigned: number;
  capacity: number;
  color: string;
  overCapacity: boolean;
}) {
  if (required <= 0.001 && assigned <= 0.001) {
    return <div className="tl-cell tl-cell-readonly tl-cell-empty" style={{ width }} />;
  }
  const short = required > 0.001 && assigned < required - 0.001;
  const fraction = capacity > 0 ? Math.min(1, assigned / capacity) : assigned > 0 ? 1 : 0;
  const alpha = assigned > 0 ? 0.16 + fraction * 0.55 : 0;
  return (
    <div
      className={`tl-cell tl-cell-readonly ${short ? 'tl-cell-short' : ''} ${overCapacity ? 'tl-cell-over' : ''}`}
      style={{ width, backgroundColor: hexToRgba(color, alpha) }}
      title={`Assigned ${assigned} · Required ${required}`}
    >
      <span className="tl-cell-value">{formatNum(assigned)}{short ? `/${formatNum(required)}` : ''}</span>
      {overCapacity && <span className="tl-cell-flag" />}
    </div>
  );
}

/** Read-only per-person FTE cell — assignment edits happen on the project page, not here. */
function PersonCell({ width, fte }: { width: number; fte: number }) {
  return (
    <div className="tl-cell tl-cell-readonly tl-cell-empty" style={{ width }}>
      {fte > 0.001 && <span className="tl-cell-value">{formatNum(fte)}</span>}
    </div>
  );
}

/** One assigned person's row under a pool, with their FTE for each period in the window. */
function PersonRows({
  engine, projectId, poolId, window, pxPerDay,
}: {
  engine: PlanningEngine;
  projectId: string;
  poolId: string;
  window: Period[];
  pxPerDay: number;
}) {
  const names = new Map<string, string>();
  const fteByPersonPeriod = new Map<string, Map<Period, number>>();
  for (const period of window) {
    for (const line of engine.getProjectPersonStaffing(projectId, period).lines) {
      if (line.poolId !== poolId) continue;
      names.set(line.personId, line.personName);
      if (!fteByPersonPeriod.has(line.personId)) fteByPersonPeriod.set(line.personId, new Map());
      fteByPersonPeriod.get(line.personId)!.set(period, line.fte);
    }
  }
  const personIds = [...names.keys()].sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));

  if (personIds.length === 0) {
    return (
      <div className="tl-pool-row tl-person-row">
        <div className="tl-label-cell tl-person-label">No one assigned yet</div>
      </div>
    );
  }

  return (
    <>
      {personIds.map((personId) => (
        <div key={personId} className="tl-pool-row tl-person-row">
          <div className="tl-label-cell tl-person-label">{names.get(personId)}</div>
          <div className="tl-cells-row">
            {window.map((period) => (
              <PersonCell key={period} width={monthWidthPx(period, pxPerDay)} fte={fteByPersonPeriod.get(personId)?.get(period) ?? 0} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

const PX_PER_DAY: Record<TimelineZoom, number> = { compact: 3, comfortable: 5, wide: 9 };

export function Timeline() {
  const engine = useStore((s) => s.engine);
  const projects = useStore((s) => s.data.projects);
  const updateProject = useStore((s) => s.updateProject);
  const createProject = useStore((s) => s.createProject);
  const setRequirement = useStore((s) => s.setRequirement);
  const openProject = useUiStore((s) => s.openProject);
  const collapsed = useUiStore((s) => s.collapsed);
  const toggleCollapse = useUiStore((s) => s.toggleCollapse);
  const zoom = useUiStore((s) => s.timelineZoom);
  const setZoom = useUiStore((s) => s.setTimelineZoom);
  const search = useUiStore((s) => s.timelineSearch);
  const setSearch = useUiStore((s) => s.setTimelineSearch);
  const storedPoolFilter = useUiStore((s) => s.timelinePoolFilter);
  const setStoredPoolFilter = useUiStore((s) => s.setTimelinePoolFilter);

  const [showNew, setShowNew] = useState(false);
  const poolFilter = storedPoolFilter ? new Set(storedPoolFilter) : null;
  const setPoolFilter = (next: Set<string> | null) => setStoredPoolFilter(next ? Array.from(next) : null);

  const pxPerDay = PX_PER_DAY[zoom];
  const window = useMemo(() => buildTimelineWindow(engine.allKnownPeriods()), [engine]);
  const totalWidth = totalWindowWidth(window, pxPerDay);
  const todayX = xForIsoDate(`${todayPeriod()}-01`, window, pxPerDay) + (new Date().getDate() - 1) * pxPerDay;

  const poolsAll = engine.pools();
  const pools = poolsAll.filter((p) => !isGenericPoolName(p.name));
  const poolById = new Map(poolsAll.map((p) => [p.id, p] as const));
  const disciplineOrder = new Map(engine.disciplines().map((d, i) => [d.id, i] as const));
  const activePoolIds = poolFilter ?? new Set(pools.map((p) => p.id));

  const scheduled = projects.filter((p) => p.startDate && p.endDate)
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : a.startDate! > b.startDate! ? 1 : 0));
  const unscheduled = projects.filter((p) => !p.startDate || !p.endDate)
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  const setManyCollapsed = useUiStore((s) => s.setManyCollapsed);
  const visibleCollapseKeys: string[] = [];
  for (const project of scheduled) {
    visibleCollapseKeys.push(`timeline:proj:${project.id}`);
    const discIdsInProject = new Set(
      engine.projectPoolIds(project.id)
        .filter((id) => {
          const pool = poolById.get(id);
          return pool && !isGenericPoolName(pool.name) && activePoolIds.has(id);
        })
        .map((id) => poolById.get(id)?.disciplineId ?? UNASSIGNED_DISCIPLINE_ID),
    );
    for (const discId of discIdsInProject) visibleCollapseKeys.push(`timeline:disc:${project.id}:${discId}`);
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon="timeline"
        title="Nothing scheduled yet"
        description="Create a project to see it on the timeline."
        action={<Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>New project</Button>}
      />
    );
  }

  return (
    <div className="timeline-view">
      <div className="view-header">
        <div>
          <h1>Timeline</h1>
          <p className="view-sub">Drag a project bar to move it, drag its edges to resize, click a cell to edit required staffing. Assigned people are managed from the project page.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>New project</Button>
      </div>

      <div className="timeline-toolbar">
        <div className="tl-search">
          <Icon name="search" size={13} />
          <input placeholder="Filter projects…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <PoolFilterMenu
          pools={pools}
          disciplineName={(pool) => (pool.disciplineId ? engine.discipline(pool.disciplineId)?.name ?? 'Unassigned' : 'Unassigned')}
          activePoolIds={activePoolIds}
          onChange={setPoolFilter}
        />
        <div className="tl-zoom">
          <button type="button" className="zoom-btn" onClick={() => setZoom(zoom === 'wide' ? 'comfortable' : 'compact')} aria-label="Zoom out"><Icon name="zoom-out" size={14} /></button>
          <span className="zoom-label">{zoom === 'compact' ? 'Compact' : zoom === 'wide' ? 'Wide' : 'Comfortable'}</span>
          <button type="button" className="zoom-btn" onClick={() => setZoom(zoom === 'compact' ? 'comfortable' : 'wide')} aria-label="Zoom in"><Icon name="zoom-in" size={14} /></button>
        </div>
        {visibleCollapseKeys.length > 0 && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setManyCollapsed(visibleCollapseKeys, false)}>Expand all</Button>
            <Button variant="ghost" size="sm" onClick={() => setManyCollapsed(visibleCollapseKeys, true)}>Collapse all</Button>
          </>
        )}
      </div>

      {unscheduled.length > 0 && (
        <UnscheduledPanel projects={unscheduled} engine={engine} onOpen={openProject} onSetDates={(p, start, end) => updateProject({ ...p, startDate: start, startCertainty: 'estimated', endDate: end, endCertainty: 'estimated' })} />
      )}

      <div className="tl-scroll">
        <div className="tl-scroll-inner" style={{ width: 200 + totalWidth }}>
          <div className="tl-today-line" style={{ left: 200 + todayX }} title="Today" />

          <div className="tl-header-row">
            <div className="tl-label-cell tl-corner">Project / Emploi repère</div>
            <div className="tl-months-row">
              {window.map((period) => (
                <div key={period} className="tl-month-header" style={{ width: monthWidthPx(period, pxPerDay) }}>
                  {formatPeriodLabel(period, { withYear: zoom !== 'compact' })}
                </div>
              ))}
            </div>
          </div>

          {scheduled.length === 0 && search ? (
            <div className="tl-no-match">No scheduled projects match "{search}"</div>
          ) : (
            scheduled.map((project) => {
              const allPoolIds = engine.projectPoolIds(project.id);
              const disciplineIdsInProject = new Set(
                allPoolIds.map((id) => poolById.get(id)?.disciplineId ?? UNASSIGNED_DISCIPLINE_ID),
              );
              const disciplineGroups = [...disciplineIdsInProject]
                .map((discId) => ({
                  discId,
                  specificPoolIds: allPoolIds.filter((id) => {
                    const pool = poolById.get(id);
                    if (!pool || isGenericPoolName(pool.name)) return false;
                    return (pool.disciplineId ?? UNASSIGNED_DISCIPLINE_ID) === discId && activePoolIds.has(id);
                  }),
                }))
                .filter((g) => g.specificPoolIds.length > 0)
                .sort((a, b) => (disciplineOrder.get(a.discId) ?? Infinity) - (disciplineOrder.get(b.discId) ?? Infinity));
              const collapseKey = `timeline:proj:${project.id}`;
              const projectCollapsed = collapsed[collapseKey] === true;
              return (
                <div key={project.id} className="tl-project-group">
                  <div className="tl-project-header-row">
                    <div className="tl-label-cell tl-project-label">
                      <button
                        type="button"
                        className="tl-project-collapse"
                        onClick={() => toggleCollapse(collapseKey)}
                        aria-label={projectCollapsed ? 'Expand' : 'Collapse'}
                      >
                        <Icon name="chevron-right" size={12} className={projectCollapsed ? '' : 'tl-project-collapse-open'} />
                      </button>
                      <button type="button" className="tl-project-name" onClick={() => openProject(project.id)}>{project.name}</button>
                      <span className={`priority-badge priority-${project.priority} tl-priority-badge`}>{project.priority}</span>
                    </div>
                    <div className="tl-lane" style={{ width: totalWidth }}>
                      <ProjectBar
                        project={project}
                        window={window}
                        pxPerDay={pxPerDay}
                        onClick={() => openProject(project.id)}
                        onDatesChange={(start, end) => updateProject({ ...project, startDate: start, endDate: end })}
                      />
                    </div>
                  </div>
                  {projectCollapsed ? null : disciplineGroups.length === 0 ? (
                    <div className="tl-pool-row tl-pool-row-empty">
                      <div className="tl-label-cell tl-pool-label">No disciplines assigned</div>
                    </div>
                  ) : (
                    disciplineGroups.map((group) => {
                      const discipline = engine.discipline(group.discId);
                      const discName = discipline?.name ?? 'Unassigned';
                      const discColor = discipline?.color ?? '#9ca3af';
                      const discCollapseKey = `timeline:disc:${project.id}:${group.discId}`;
                      const discCollapsed = collapsed[discCollapseKey] === true;
                      return (
                        <div key={group.discId} className="tl-disc-group">
                          <div className="tl-pool-row tl-disc-row">
                            <div className="tl-label-cell tl-disc-label">
                              <button
                                type="button"
                                className="tl-project-collapse"
                                onClick={() => toggleCollapse(discCollapseKey)}
                                aria-label={discCollapsed ? 'Expand' : 'Collapse'}
                              >
                                <Icon name="chevron-right" size={11} className={discCollapsed ? '' : 'tl-project-collapse-open'} />
                              </button>
                              <span className="discipline-dot" style={{ background: discColor }} />
                              {discName}
                            </div>
                            <div className="tl-cells-row">
                              {window.map((period) => {
                                const staffing = engine.getProjectStaffing(project.id, period);
                                let required = 0;
                                let assigned = 0;
                                for (const id of allPoolIds) {
                                  const pool = poolById.get(id);
                                  if ((pool?.disciplineId ?? UNASSIGNED_DISCIPLINE_ID) !== group.discId) continue;
                                  const line = staffing.lines.find((l) => l.poolId === id);
                                  if (!line) continue;
                                  required += line.required;
                                  if (!pool || !isGenericPoolName(pool.name)) assigned += line.assigned;
                                }
                                const capacity = engine.getDisciplineCapacity(group.discId, period);
                                const overCapacity = capacity < engine.getDisciplineRequiredCapacity(group.discId, period) - 0.001;
                                return (
                                  <DisciplineCell
                                    key={period}
                                    width={monthWidthPx(period, pxPerDay)}
                                    required={round2(required)}
                                    assigned={round2(assigned)}
                                    capacity={capacity}
                                    color={discColor}
                                    overCapacity={overCapacity}
                                  />
                                );
                              })}
                            </div>
                          </div>
                          {!discCollapsed && group.specificPoolIds.map((poolId) => {
                            const pool = poolById.get(poolId)!;
                            const poolCollapseKey = `timeline:pool:${project.id}:${poolId}`;
                            // Reuses the shared collapsed map, but here `true` means "people shown" (default hidden).
                            const peopleShown = collapsed[poolCollapseKey] === true;
                            return (
                              <Fragment key={poolId}>
                                <div className="tl-pool-row tl-pool-row-nested">
                                  <div className="tl-label-cell tl-pool-label">
                                    <button
                                      type="button"
                                      className="tl-project-collapse"
                                      onClick={() => toggleCollapse(poolCollapseKey)}
                                      aria-label={peopleShown ? 'Hide people' : 'Show people'}
                                    >
                                      <Icon name="chevron-right" size={10} className={peopleShown ? 'tl-project-collapse-open' : ''} />
                                    </button>
                                    <span className="pool-dot" style={{ background: pool.color }} />
                                    {pool.name}
                                  </div>
                                  <div className="tl-cells-row">
                                    {window.map((period) => {
                                      const staffing = engine.getProjectStaffing(project.id, period);
                                      const line = staffing.lines.find((l) => l.poolId === poolId);
                                      return (
                                        <AllocationCell
                                          key={period}
                                          width={monthWidthPx(period, pxPerDay)}
                                          required={line?.required ?? 0}
                                          assigned={line?.assigned ?? 0}
                                          capacity={engine.getCapacity(poolId, period)}
                                          poolColor={pool.color}
                                          overCapacity={engine.isOverCapacity(poolId, period)}
                                          onSetRequired={(v) => setRequirement(project.id, poolId, period, v)}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                                {peopleShown && (
                                  <PersonRows engine={engine} projectId={project.id} poolId={poolId} window={window} pxPerDay={pxPerDay} />
                                )}
                              </Fragment>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {showNew && (
        <ProjectFormDrawer
          onClose={() => setShowNew(false)}
          onSave={(value: ProjectFormValue) => {
            createProject(value);
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
