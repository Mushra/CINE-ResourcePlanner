import { Fragment, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { addMonths, formatPeriodLabel, periodFromISODate, periodRange, todayPeriod } from '../../domain/periods';
import { getSanityChecks } from '../../engine/validation';
import { isGenericPoolName } from '../../domain/identity';
import type { Period } from '../../domain/types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { NumberField } from '../components/NumberField';
import { ConfirmButton } from '../components/ConfirmButton';
import { Collapsible } from '../components/Collapsible';
import { ProjectFormDrawer, type ProjectFormValue } from '../components/ProjectFormDrawer';
import { RequirementTimeline, type RequirementLane } from '../components/RequirementTimeline';

const CERTAINTY_LABEL: Record<string, string> = { confirmed: 'Confirmed', estimated: 'Estimated', tbd: 'TBD' };

interface ColumnDef {
  key: string;
  label: string;
  periods: Period[];
}

/** Groups `months` into either one column per month, or one column per year (for the year-granularity Besoins table). */
function buildColumns(months: Period[], granularity: 'month' | 'year'): ColumnDef[] {
  if (granularity === 'month') {
    return months.map((m) => ({ key: m, label: formatPeriodLabel(m, { withYear: false }), periods: [m] }));
  }
  const byYear = new Map<string, Period[]>();
  for (const m of months) {
    const year = m.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(m);
  }
  return [...byYear.entries()].map(([year, periods]) => ({ key: year, label: year, periods }));
}

/** A year column's display value is its first month's; `mixed` flags when the months disagree. */
function columnValue(periods: Period[], months: Period[], requiredByMonth: number[]): { value: number; mixed: boolean } {
  const vals = periods.map((p) => requiredByMonth[months.indexOf(p)] ?? 0);
  const first = vals[0] ?? 0;
  const mixed = vals.some((v) => Math.abs(v - first) > 0.001);
  return { value: first, mixed };
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.data.projects.find((p) => p.id === projectId));
  const engine = useStore((s) => s.engine);
  const disciplines = useStore((s) => s.data.disciplines);
  const pools = useStore((s) => s.data.pools);
  const people = useStore((s) => s.data.people);
  const requirements = useStore((s) => s.data.requirements);
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const setRequirement = useStore((s) => s.setRequirement);
  const setRequirementRange = useStore((s) => s.setRequirementRange);
  const setDisciplineRequirement = useStore((s) => s.setDisciplineRequirement);
  const setDisciplineRequirementRange = useStore((s) => s.setDisciplineRequirementRange);
  const setPersonAssignment = useStore((s) => s.setPersonAssignment);
  const setPersonAssignmentRange = useStore((s) => s.setPersonAssignmentRange);
  const clearRequirementPool = useStore((s) => s.clearRequirementPool);
  const clearPersonAssignment = useStore((s) => s.clearPersonAssignment);
  const feedRequirementsFromAssignments = useStore((s) => s.feedRequirementsFromAssignments);
  const backToProjects = useUiStore((s) => s.backToProjects);
  const collapsed = useUiStore((s) => s.collapsed);
  const toggleCollapse = useUiStore((s) => s.toggleCollapse);
  const besoinsMode = useUiStore((s) => s.besoinsMode);
  const setBesoinsMode = useUiStore((s) => s.setBesoinsMode);
  const besoinsGranularity = useUiStore((s) => s.besoinsGranularity);
  const setBesoinsGranularity = useUiStore((s) => s.setBesoinsGranularity);
  const assignationsGranularity = useUiStore((s) => s.assignationsGranularity);
  const setAssignationsGranularity = useUiStore((s) => s.setAssignationsGranularity);
  const [editing, setEditing] = useState(false);

  const checks = project ? getSanityChecks(engine).filter((c) => c.projectId === project.id) : [];

  if (!project) {
    return (
      <div className="project-detail-view">
        <button type="button" className="back-link" onClick={backToProjects}><Icon name="arrow-left" size={14} /> Back to projects</button>
        <p>This project no longer exists.</p>
      </div>
    );
  }

  const explicitLifecycle = periodRange(periodFromISODate(project.startDate), periodFromISODate(project.endDate));
  const allocatedPeriods = engine.projectAllocatedPeriods(project.id);
  const months = explicitLifecycle.length > 0
    ? explicitLifecycle
    : (allocatedPeriods.length > 0 ? allocatedPeriods : periodRange(todayPeriod(), addMonths(todayPeriod(), 3)));

  const requirementPoolIds = new Set(requirements.filter((r) => r.projectId === project.id).map((r) => r.poolId));
  const requirementPools = pools.filter((p) => requirementPoolIds.has(p.id));
  const genericRequirementPools = requirementPools.filter((p) => isGenericPoolName(p.name));
  const specificRequirementPools = requirementPools.filter((p) => !isGenericPoolName(p.name));

  const requirementDisciplineIds = new Set(
    [...genericRequirementPools, ...specificRequirementPools]
      .map((p) => p.disciplineId)
      .filter((id): id is string => id !== null),
  );
  const requirementDisciplines = disciplines.filter((d) => requirementDisciplineIds.has(d.id));
  const unassignedSpecificPools = specificRequirementPools.filter((p) => p.disciplineId === null);

  const requirementTargetOptions = [
    ...disciplines.map((d) => ({ id: `disc:${d.id}`, label: `${d.name} (whole discipline)` })),
    ...pools.filter((p) => !isGenericPoolName(p.name)).map((p) => ({ id: p.id, label: p.name })),
  ];

  const usedPoolIds = new Set(engine.projectPoolIds(project.id));
  const usedPools = pools.filter((p) => usedPoolIds.has(p.id) && !isGenericPoolName(p.name));

  const columns = buildColumns(months, besoinsGranularity);
  const assignColumns = buildColumns(months, assignationsGranularity);

  const genericPoolLanes: RequirementLane[] = genericRequirementPools.map((pool) => {
    const discipline = disciplines.find((d) => d.id === pool.disciplineId);
    return {
      key: `disc:${pool.disciplineId}`,
      label: discipline?.name ?? 'Discipline',
      color: discipline?.color ?? '#9ca3af',
      values: months.map((m) => engine.getProjectStaffing(project.id, m).lines.find((l) => l.poolId === pool.id)?.required ?? 0),
      onCommitRange: (periods, fte) => setDisciplineRequirementRange(project.id, pool.disciplineId!, periods, fte),
      onRemove: () => clearRequirementPool(project.id, pool.id),
    };
  });
  const specificPoolLanes: RequirementLane[] = specificRequirementPools.map((pool) => ({
    key: pool.id,
    label: pool.name,
    color: pool.color,
    values: months.map((m) => engine.getProjectStaffing(project.id, m).lines.find((l) => l.poolId === pool.id)?.required ?? 0),
    onCommitRange: (periods, fte) => setRequirementRange(project.id, pool.id, periods, fte),
    onRemove: () => {
      clearRequirementPool(project.id, pool.id);
      engine.peopleInPool(pool.id).forEach((person) => clearPersonAssignment(person.id, project.id));
    },
  }));
  const timelineLanes = [...genericPoolLanes, ...specificPoolLanes];
  const presentTargetIds = new Set([
    ...genericRequirementPools.map((p) => `disc:${p.disciplineId}`),
    ...specificRequirementPools.map((p) => p.id),
  ]);
  const timelineAddOptions = requirementTargetOptions.filter((o) => !presentTargetIds.has(o.id));

  return (
    <div className="project-detail-view">
      <button type="button" className="back-link" onClick={backToProjects}><Icon name="arrow-left" size={14} /> Back to projects</button>

      <div className="card detail-header">
        <div className="detail-header-top">
          <div>
            <h1>{project.name}</h1>
            <div className="detail-meta">
              <span className={`status-dot status-${project.status}`} />
              <span>{project.status.replace('_', ' ')}</span>
              <span className="meta-sep">·</span>
              <span className={`priority-badge priority-${project.priority}`}>{project.priority}</span>
              {project.isDispo && (
                <>
                  <span className="meta-sep">·</span>
                  <span className="dispo-badge">Dispo</span>
                </>
              )}
            </div>
          </div>
          <div className="detail-header-actions">
            <Button variant="secondary" icon="edit" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            <ConfirmButton label="Delete" onConfirm={() => { deleteProject(project.id); backToProjects(); }} />
          </div>
        </div>

        <div className="detail-dates">
          <DateChip label="Start" date={project.startDate} certainty={project.startCertainty} />
          <DateChip label="End" date={project.endDate} certainty={project.endCertainty} />
        </div>

        {project.notes && <p className="detail-notes">{project.notes}</p>}

        {checks.length > 0 && (
          <Collapsible scopeKey={`projdetail:checks:${project.id}`} count={checks.length} summary={<span>Warnings</span>}>
            <div className="detail-checks">
              {checks.map((c) => (
                <div key={c.id} className="detail-check-row">
                  <StatusPill tone={c.severity}>{c.severity}</StatusPill>
                  <span>{c.message} — {c.impact}</span>
                </div>
              ))}
            </div>
          </Collapsible>
        )}
      </div>

      <div className="card requirements-card">
        <div className="panel-header">
          <h2>Besoins</h2>
          <span className="panel-sub">What the project needs, by role and month</span>
          <div className="panel-header-toggles">
            <Button variant="ghost" size="sm" onClick={() => feedRequirementsFromAssignments(project.id, 'fill-empty')}>Fill empty from assignments</Button>
            <ConfirmButton
              label="= assignments"
              confirmLabel="Overwrite"
              icon="download"
              onConfirm={() => feedRequirementsFromAssignments(project.id, 'overwrite')}
            />
            {besoinsMode === 'table' && (
              <div className="segmented segmented-sm">
                <button type="button" className={besoinsGranularity === 'month' ? 'active' : ''} onClick={() => setBesoinsGranularity('month')}>Month</button>
                <button type="button" className={besoinsGranularity === 'year' ? 'active' : ''} onClick={() => setBesoinsGranularity('year')}>Year</button>
              </div>
            )}
            <div className="segmented segmented-sm">
              <button type="button" className={besoinsMode === 'table' ? 'active' : ''} onClick={() => setBesoinsMode('table')}>Table</button>
              <button type="button" className={besoinsMode === 'timeline' ? 'active' : ''} onClick={() => setBesoinsMode('timeline')}>Timeline</button>
            </div>
          </div>
        </div>

        <RangePanel
          options={requirementTargetOptions}
          months={months}
          onApply={(targetId, periods, fte) => (
            targetId.startsWith('disc:')
              ? setDisciplineRequirementRange(project.id, targetId.slice(5), periods, fte)
              : setRequirementRange(project.id, targetId, periods, fte)
          )}
        />

        {requirementDisciplines.length === 0 && unassignedSpecificPools.length === 0 ? (
          <p className="empty-inline">No resource requirements yet. Use the panel above to set a need — pick a whole discipline for a headcount minimum, or a specific role.</p>
        ) : besoinsMode === 'timeline' ? (
          <RequirementTimeline
            months={months}
            lanes={timelineLanes}
            addOptions={timelineAddOptions}
            onAddLane={(targetId) => (
              targetId.startsWith('disc:')
                ? setDisciplineRequirement(project.id, targetId.slice(5), months[0], 1)
                : setRequirement(project.id, targetId, months[0], 1)
            )}
          />
        ) : (
          <div className="table-scroll">
            <table className="alloc-table">
              <thead>
                <tr>
                  <th className="alloc-row-label">Discipline / Emploi repère</th>
                  {columns.map((c) => <th key={c.key}>{c.label}</th>)}
                  <th className="alloc-actions-col" />
                </tr>
              </thead>
              <tbody>
                {requirementDisciplines.map((discipline) => {
                  const genericPool = genericRequirementPools.find((p) => p.disciplineId === discipline.id);
                  const specificPools = specificRequirementPools.filter((p) => p.disciplineId === discipline.id);
                  const collapseKey = `projdetail:req-disc:${project.id}:${discipline.id}`;
                  const rowsCollapsed = specificPools.length > 0 && collapsed[collapseKey] === true;
                  const requiredByMonth = months.map((m) => genericPool && engine.getProjectStaffing(project.id, m).lines.find((l) => l.poolId === genericPool.id)?.required || 0);
                  return (
                    <Fragment key={discipline.id}>
                      <tr className="requirement-discipline-row">
                        <td className="alloc-row-label">
                          {specificPools.length > 0 && (
                            <button
                              type="button"
                              className="alloc-row-collapse"
                              onClick={() => toggleCollapse(collapseKey)}
                              aria-label={rowsCollapsed ? 'Expand' : 'Collapse'}
                            >
                              <Icon name="chevron-right" size={11} className={rowsCollapsed ? '' : 'alloc-row-collapse-open'} />
                            </button>
                          )}
                          <span className="discipline-dot" style={{ background: discipline.color }} />
                          {discipline.name}
                        </td>
                        {columns.map((col, i) => {
                          const { value, mixed } = columnValue(col.periods, months, requiredByMonth);
                          return (
                            <AllocCell
                              key={col.key}
                              value={value}
                              mixed={mixed}
                              onCommit={(v) => setDisciplineRequirementRange(project.id, discipline.id, col.periods, v)}
                              onFillRight={i < columns.length - 1 ? () => setDisciplineRequirementRange(project.id, discipline.id, columns.slice(i + 1).flatMap((c) => c.periods), value) : undefined}
                            />
                          );
                        })}
                        <td className="alloc-actions-col">
                          {genericPool && (
                            <ConfirmButton
                              label="Remove"
                              onConfirm={() => clearRequirementPool(project.id, genericPool.id)}
                            />
                          )}
                        </td>
                      </tr>
                      {!rowsCollapsed && specificPools.map((pool) => {
                        const poolRequiredByMonth = months.map((m) => engine.getProjectStaffing(project.id, m).lines.find((l) => l.poolId === pool.id)?.required ?? 0);
                        return (
                          <tr key={pool.id} className="requirement-pool-row">
                            <td className="alloc-row-label alloc-row-label-indent">
                              <span className="pool-dot" style={{ background: pool.color }} />
                              {pool.name}
                            </td>
                            {columns.map((col, i) => {
                              const { value, mixed } = columnValue(col.periods, months, poolRequiredByMonth);
                              return (
                                <AllocCell
                                  key={col.key}
                                  value={value}
                                  mixed={mixed}
                                  onCommit={(v) => setRequirementRange(project.id, pool.id, col.periods, v)}
                                  onFillRight={i < columns.length - 1 ? () => setRequirementRange(project.id, pool.id, columns.slice(i + 1).flatMap((c) => c.periods), value) : undefined}
                                />
                              );
                            })}
                            <td className="alloc-actions-col">
                              <ConfirmButton
                                label="Remove"
                                onConfirm={() => {
                                  clearRequirementPool(project.id, pool.id);
                                  engine.peopleInPool(pool.id).forEach((person) => clearPersonAssignment(person.id, project.id));
                                }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {unassignedSpecificPools.map((pool) => {
                  const requiredByMonth = months.map((m) => engine.getProjectStaffing(project.id, m).lines.find((l) => l.poolId === pool.id)?.required ?? 0);
                  return (
                    <tr key={pool.id}>
                      <td className="alloc-row-label">
                        <span className="pool-dot" style={{ background: pool.color }} />
                        {pool.name}
                      </td>
                      {columns.map((col, i) => {
                        const { value, mixed } = columnValue(col.periods, months, requiredByMonth);
                        return (
                          <AllocCell
                            key={col.key}
                            value={value}
                            mixed={mixed}
                            onCommit={(v) => setRequirementRange(project.id, pool.id, col.periods, v)}
                            onFillRight={i < columns.length - 1 ? () => setRequirementRange(project.id, pool.id, columns.slice(i + 1).flatMap((c) => c.periods), value) : undefined}
                          />
                        );
                      })}
                      <td className="alloc-actions-col">
                        <ConfirmButton
                          label="Remove"
                          onConfirm={() => {
                            clearRequirementPool(project.id, pool.id);
                            engine.peopleInPool(pool.id).forEach((person) => clearPersonAssignment(person.id, project.id));
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card requirements-card">
        <div className="panel-header">
          <h2>Assignations</h2>
          <span className="panel-sub">Who is actually staffed, by month</span>
          <div className="panel-header-toggles">
            <div className="segmented segmented-sm">
              <button type="button" className={assignationsGranularity === 'month' ? 'active' : ''} onClick={() => setAssignationsGranularity('month')}>Month</button>
              <button type="button" className={assignationsGranularity === 'year' ? 'active' : ''} onClick={() => setAssignationsGranularity('year')}>Year</button>
            </div>
          </div>
        </div>

        <RangePanel
          options={people.map((p) => ({ id: p.id, label: p.poolId ? `${p.name} (${pools.find((pl) => pl.id === p.poolId)?.name ?? ''})` : p.name }))}
          months={months}
          fteLabel="FTE"
          onApply={(personId, periods, fte) => setPersonAssignmentRange(personId, project.id, periods, fte)}
        />

        {usedPools.length === 0 ? (
          <p className="empty-inline">No one is assigned yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="alloc-table">
              <thead>
                <tr>
                  <th className="alloc-row-label">Person</th>
                  {assignColumns.map((c) => <th key={c.key}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {usedPools.map((pool) => {
                  const staffingByMonth = months.map((m) => engine.getProjectStaffing(project.id, m).lines.find((l) => l.poolId === pool.id));
                  const personLinesByMonth = months.map((m) => engine.getProjectPersonStaffing(project.id, m).lines.filter((l) => l.poolId === pool.id));
                  const requiredByMonth = staffingByMonth.map((s) => s?.required ?? 0);
                  const assignedByMonth = staffingByMonth.map((s) => s?.assigned ?? 0);

                  const assignedPeople = new Map<string, string>();
                  personLinesByMonth.forEach((lines) => lines.forEach((l) => assignedPeople.set(l.personId, l.personName)));
                  const assignedPersonIds = [...assignedPeople.keys()].sort((a, b) => assignedPeople.get(a)!.localeCompare(assignedPeople.get(b)!));

                  const addablePeople = people.filter((p) => p.poolId === pool.id && !assignedPeople.has(p.id));

                  return (
                    <Fragment key={pool.id}>
                      <tr className="pool-subheader-row">
                        <td className="pool-subheader" colSpan={assignColumns.length + 1}>
                          <span className="pool-dot" style={{ background: pool.color }} />
                          {pool.name}
                        </td>
                      </tr>
                      {assignedPersonIds.map((personId) => (
                        <tr key={personId}>
                          <td className="alloc-kind-label person-row-label">
                            {assignedPeople.get(personId)}
                            <button type="button" className="person-row-remove" title="Unassign" onClick={() => clearPersonAssignment(personId, project.id)}>
                              <Icon name="close" size={11} />
                            </button>
                          </td>
                          {assignColumns.map((col, i) => {
                            const { value: required } = columnValue(col.periods, months, requiredByMonth);
                            const { value: assigned } = columnValue(col.periods, months, assignedByMonth);
                            const short = required > 0 && assigned < required - 0.001;
                            const fteByMonth = months.map((_, mi) => personLinesByMonth[mi].find((l) => l.personId === personId)?.fte ?? 0);
                            const { value: fte, mixed } = columnValue(col.periods, months, fteByMonth);
                            return (
                              <AllocCell
                                key={col.key}
                                value={fte}
                                mixed={mixed}
                                highlightShort={short}
                                onCommit={(v) => setPersonAssignmentRange(personId, project.id, col.periods, v)}
                                onFillRight={i < assignColumns.length - 1 ? () => setPersonAssignmentRange(personId, project.id, assignColumns.slice(i + 1).flatMap((c) => c.periods), fte) : undefined}
                              />
                            );
                          })}
                        </tr>
                      ))}
                      {addablePeople.length > 0 && (
                        <tr>
                          <td className="alloc-kind-label">
                            <select
                              className="person-add-select"
                              defaultValue=""
                              onChange={(e) => {
                                if (e.target.value) setPersonAssignment(e.target.value, project.id, months[0] ?? todayPeriod(), 1);
                                e.target.value = '';
                              }}
                            >
                              <option value="" disabled>+ Add person…</option>
                              {addablePeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </td>
                          {assignColumns.map((c) => <td key={c.key} className="alloc-cell" />)}
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <ProjectFormDrawer
          project={project}
          onClose={() => setEditing(false)}
          onSave={(value: ProjectFormValue) => {
            updateProject({ ...project, ...value });
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function DateChip({ label, date, certainty }: { label: string; date: string | null; certainty: string }) {
  return (
    <div className={`date-chip certainty-${certainty}`}>
      <span className="date-chip-label">{label}</span>
      <span className="date-chip-value">{date ?? 'TBD'}</span>
      <span className="date-chip-certainty">{CERTAINTY_LABEL[certainty]}</span>
    </div>
  );
}

/** One grid cell: an editable FTE plus a fill-right affordance that copies its value to every month after it. */
function AllocCell({ value, onCommit, onFillRight, highlightShort, mixed }: {
  value: number;
  onCommit: (value: number) => void;
  onFillRight?: () => void;
  highlightShort?: boolean;
  mixed?: boolean;
}) {
  return (
    <td className={`alloc-cell ${highlightShort ? 'alloc-cell-short' : ''} ${mixed ? 'alloc-cell-mixed' : ''}`} title={mixed ? 'Months in this year have different values' : undefined}>
      <div className="alloc-cell-inner">
        <NumberField value={value} onCommit={onCommit} onFillRight={onFillRight} className="num-input" />
        {onFillRight && (
          <button type="button" className="alloc-fill-right" title="Fill right with this value" onClick={onFillRight}>
            <Icon name="chevron-right" size={10} />
          </button>
        )}
      </div>
    </td>
  );
}

/** Bulk-entry panel: pick a target (pool or person), a month range and an FTE, apply to every month at once. */
function RangePanel({ options, months, onApply, fteLabel = 'FTE' }: {
  options: { id: string; label: string }[];
  months: Period[];
  onApply: (targetId: string, periods: Period[], fte: number) => void;
  fteLabel?: string;
}) {
  const targetRef = useRef<HTMLSelectElement>(null);
  const fromRef = useRef<HTMLSelectElement>(null);
  const toRef = useRef<HTMLSelectElement>(null);
  const fteRef = useRef<HTMLInputElement>(null);

  if (options.length === 0) return null;

  return (
    <div className="range-panel">
      <select ref={targetRef} className="range-panel-select" defaultValue={options[0].id}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <span className="range-panel-label">from</span>
      <select ref={fromRef} defaultValue="0">
        {months.map((m, i) => <option key={m} value={i}>{formatPeriodLabel(m, { withYear: false })}</option>)}
      </select>
      <span className="range-panel-label">to</span>
      <select ref={toRef} defaultValue={String(months.length - 1)}>
        {months.map((m, i) => <option key={m} value={i}>{formatPeriodLabel(m, { withYear: false })}</option>)}
      </select>
      <input ref={fteRef} type="number" step={0.5} min={0} defaultValue={1} className="num-input range-panel-fte" title={fteLabel} />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          const targetId = targetRef.current!.value;
          const fromIdx = Number(fromRef.current!.value);
          const toIdx = Number(toRef.current!.value);
          const fte = parseFloat(fteRef.current!.value ?? '') || 0;
          if (!targetId || fromIdx > toIdx) return;
          onApply(targetId, months.slice(fromIdx, toIdx + 1), fte);
        }}
      >
        Apply
      </Button>
    </div>
  );
}
