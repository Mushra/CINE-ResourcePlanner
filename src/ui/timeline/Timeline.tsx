import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { buildTimelineWindow, monthWidthPx, totalWindowWidth, xForIsoDate } from './timelineMath';
import { formatPeriodLabel, todayPeriod } from '../../domain/periods';
import { ProjectBar } from './ProjectBar';
import { AllocationCell } from './AllocationCell';
import { UnscheduledPanel } from './UnscheduledPanel';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ProjectFormDrawer, type ProjectFormValue } from '../components/ProjectFormDrawer';
import type { TimelineZoom } from '../../store/useUiStore';

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

  const pools = engine.pools();
  const activePoolIds = poolFilter ?? new Set(pools.map((p) => p.id));

  const scheduled = projects.filter((p) => p.startDate && p.endDate)
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : a.startDate! > b.startDate! ? 1 : 0));
  const unscheduled = projects.filter((p) => !p.startDate || !p.endDate)
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));

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
        <div className="tl-pool-chips">
          {pools.map((pool) => {
            const on = activePoolIds.has(pool.id);
            return (
              <button
                key={pool.id}
                type="button"
                className={`pool-chip ${on ? 'on' : ''}`}
                style={on ? { borderColor: pool.color, color: pool.color, background: `${pool.color}14` } : undefined}
                onClick={() => {
                  const next = new Set(activePoolIds);
                  if (next.has(pool.id) && next.size === pools.length) {
                    setPoolFilter(new Set([pool.id]));
                  } else if (next.has(pool.id)) {
                    next.delete(pool.id);
                    setPoolFilter(next);
                  } else {
                    next.add(pool.id);
                    setPoolFilter(next.size === pools.length ? null : next);
                  }
                }}
              >
                <span className="pool-dot" style={{ background: pool.color }} />
                {pool.name}
              </button>
            );
          })}
          {poolFilter && <button type="button" className="pool-chip-reset" onClick={() => setPoolFilter(null)}>Clear</button>}
        </div>
        <div className="tl-zoom">
          <button type="button" className="zoom-btn" onClick={() => setZoom(zoom === 'wide' ? 'comfortable' : 'compact')} aria-label="Zoom out"><Icon name="zoom-out" size={14} /></button>
          <span className="zoom-label">{zoom === 'compact' ? 'Compact' : zoom === 'wide' ? 'Wide' : 'Comfortable'}</span>
          <button type="button" className="zoom-btn" onClick={() => setZoom(zoom === 'compact' ? 'comfortable' : 'wide')} aria-label="Zoom in"><Icon name="zoom-in" size={14} /></button>
        </div>
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
              const poolIds = engine.projectPoolIds(project.id).filter((id) => activePoolIds.has(id));
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
                  {projectCollapsed ? null : poolIds.length === 0 ? (
                    <div className="tl-pool-row tl-pool-row-empty">
                      <div className="tl-label-cell tl-pool-label">No disciplines assigned</div>
                    </div>
                  ) : (
                    poolIds.map((poolId) => {
                      const pool = pools.find((p) => p.id === poolId)!;
                      return (
                        <div key={poolId} className="tl-pool-row">
                          <div className="tl-label-cell tl-pool-label">
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
