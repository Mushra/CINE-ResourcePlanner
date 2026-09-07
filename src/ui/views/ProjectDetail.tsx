import { Fragment, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { addMonths, formatPeriodLabel, periodFromISODate, periodRange, todayPeriod } from '../../domain/periods';
import { getSanityChecks } from '../../engine/validation';
import type { Period } from '../../domain/types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { NumberField } from '../components/NumberField';
import { ConfirmButton } from '../components/ConfirmButton';
import { ProjectFormDrawer, type ProjectFormValue } from '../components/ProjectFormDrawer';

const CERTAINTY_LABEL: Record<string, string> = { confirmed: 'Confirmed', estimated: 'Estimated', tbd: 'TBD' };

export function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.data.projects.find((p) => p.id === projectId));
  const engine = useStore((s) => s.engine);
  const pools = useStore((s) => s.data.pools);
  const people = useStore((s) => s.data.people);
  const requirements = useStore((s) => s.data.requirements);
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const setRequirement = useStore((s) => s.setRequirement);
  const setRequirementRange = useStore((s) => s.setRequirementRange);
  const setPersonAssignment = useStore((s) => s.setPersonAssignment);
  const setPersonAssignmentRange = useStore((s) => s.setPersonAssignmentRange);
  const clearRequirementPool = useStore((s) => s.clearRequirementPool);
  const clearPersonAssignment = useStore((s) => s.clearPersonAssignment);
  const backToProjects = useUiStore((s) => s.backToProjects);
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

  const usedPoolIds = new Set(engine.projectPoolIds(project.id));
  const usedPools = pools.filter((p) => usedPoolIds.has(p.id));

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
          <div className="detail-checks">
            {checks.map((c) => (
              <div key={c.id} className="detail-check-row">
                <StatusPill tone={c.severity}>{c.severity}</StatusPill>
                <span>{c.message} — {c.impact}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card requirements-card">
        <div className="panel-header">
          <h2>Besoins</h2>
          <span className="panel-sub">What the project needs, by role and month</span>
        </div>

        <RangePanel
          options={pools.map((p) => ({ id: p.id, label: p.name }))}
          months={months}
          onApply={(poolId, periods, fte) => setRequirementRange(project.id, poolId, periods, fte)}
        />

        {requirementPools.length === 0 ? (
          <p className="empty-inline">No resource requirements yet. Use the panel above to set a need.</p>
        ) : (
          <div className="table-scroll">
            <table className="alloc-table">
              <thead>
                <tr>
                  <th className="alloc-row-label">Emploi repère</th>
                  {months.map((m) => <th key={m}>{formatPeriodLabel(m, { withYear: false })}</th>)}
                  <th className="alloc-actions-col" />
                </tr>
              </thead>
              <tbody>
                {requirementPools.map((pool) => {
                  const staffingByMonth = months.map((m) => engine.getProjectStaffing(project.id, m).lines.find((l) => l.poolId === pool.id));
                  return (
                    <tr key={pool.id}>
                      <td className="alloc-row-label">
                        <span className="pool-dot" style={{ background: pool.color }} />
                        {pool.name}
                      </td>
                      {months.map((m, i) => (
                        <AllocCell
                          key={m}
                          value={staffingByMonth[i]?.required ?? 0}
                          onCommit={(v) => setRequirement(project.id, pool.id, m, v)}
                          onFillRight={i < months.length - 1 ? () => setRequirementRange(project.id, pool.id, months.slice(i + 1), staffingByMonth[i]?.required ?? 0) : undefined}
                        />
                      ))}
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
                  {months.map((m) => <th key={m}>{formatPeriodLabel(m, { withYear: false })}</th>)}
                </tr>
              </thead>
              <tbody>
                {usedPools.map((pool) => {
                  const staffingByMonth = months.map((m) => engine.getProjectStaffing(project.id, m).lines.find((l) => l.poolId === pool.id));
                  const personLinesByMonth = months.map((m) => engine.getProjectPersonStaffing(project.id, m).lines.filter((l) => l.poolId === pool.id));

                  const assignedPeople = new Map<string, string>();
                  personLinesByMonth.forEach((lines) => lines.forEach((l) => assignedPeople.set(l.personId, l.personName)));
                  const assignedPersonIds = [...assignedPeople.keys()].sort((a, b) => assignedPeople.get(a)!.localeCompare(assignedPeople.get(b)!));

                  const addablePeople = people.filter((p) => p.poolId === pool.id && !assignedPeople.has(p.id));

                  return (
                    <Fragment key={pool.id}>
                      <tr className="pool-subheader-row">
                        <td className="pool-subheader" colSpan={months.length + 1}>
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
                          {months.map((m, i) => {
                            const required = staffingByMonth[i]?.required ?? 0;
                            const assigned = staffingByMonth[i]?.assigned ?? 0;
                            const short = required > 0 && assigned < required - 0.001;
                            const fte = personLinesByMonth[i].find((l) => l.personId === personId)?.fte ?? 0;
                            return (
                              <AllocCell
                                key={m}
                                value={fte}
                                highlightShort={short}
                                onCommit={(v) => setPersonAssignment(personId, project.id, m, v)}
                                onFillRight={i < months.length - 1 ? () => setPersonAssignmentRange(personId, project.id, months.slice(i + 1), fte) : undefined}
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
                          {months.map((m) => <td key={m} className="alloc-cell" />)}
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
function AllocCell({ value, onCommit, onFillRight, highlightShort }: {
  value: number;
  onCommit: (value: number) => void;
  onFillRight?: () => void;
  highlightShort?: boolean;
}) {
  return (
    <td className={`alloc-cell ${highlightShort ? 'alloc-cell-short' : ''}`}>
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
