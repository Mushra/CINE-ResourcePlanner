import { Fragment, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { addMonths, formatPeriodLabel, periodFromISODate, periodRange, todayPeriod } from '../../domain/periods';
import { getSanityChecks } from '../../engine/validation';
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
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const setRequirement = useStore((s) => s.setRequirement);
  const setAssignment = useStore((s) => s.setAssignment);
  const clearRequirementPool = useStore((s) => s.clearRequirementPool);
  const clearAssignmentPool = useStore((s) => s.clearAssignmentPool);
  const backToProjects = useUiStore((s) => s.backToProjects);
  const [editing, setEditing] = useState(false);
  const [addingPool, setAddingPool] = useState(false);

  const checks = useMemo(() => (project ? getSanityChecks(engine).filter((c) => c.projectId === project.id) : []), [engine, project]);

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

  const usedPoolIds = new Set(engine.projectPoolIds(project.id));
  const usedPools = pools.filter((p) => usedPoolIds.has(p.id));
  const availablePools = pools.filter((p) => !usedPoolIds.has(p.id));

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
          <h2>Resource requirements</h2>
          {availablePools.length > 0 && (
            addingPool ? (
              <select
                autoFocus
                className="pool-add-select"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) setRequirement(project.id, e.target.value, months[0] ?? todayPeriod(), 1);
                  setAddingPool(false);
                }}
                onBlur={() => setAddingPool(false)}
              >
                <option value="" disabled>Choose a discipline…</option>
                {availablePools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <Button variant="ghost" size="sm" icon="plus" onClick={() => setAddingPool(true)}>Add discipline</Button>
            )
          )}
        </div>

        {usedPools.length === 0 ? (
          <p className="empty-inline">No resource requirements yet. Add a discipline to start planning.</p>
        ) : (
          <div className="table-scroll">
            <table className="alloc-table">
              <thead>
                <tr>
                  <th className="alloc-row-label">Discipline</th>
                  <th className="alloc-kind-label" />
                  {months.map((m) => <th key={m}>{formatPeriodLabel(m, { withYear: false })}</th>)}
                  <th className="alloc-actions-col" />
                </tr>
              </thead>
              <tbody>
                {usedPools.map((pool) => {
                  const staffingByMonth = months.map((m) => engine.getProjectStaffing(project.id, m).lines.find((l) => l.poolId === pool.id));
                  return (
                    <Fragment key={pool.id}>
                      <tr className="pool-group-row">
                        <td className="alloc-row-label" rowSpan={2}>
                          <span className="pool-dot" style={{ background: pool.color }} />
                          {pool.name}
                        </td>
                        <td className="alloc-kind-label">Required</td>
                        {months.map((m, i) => (
                          <td key={m} className="alloc-cell">
                            <NumberField value={staffingByMonth[i]?.required ?? 0} onCommit={(v) => setRequirement(project.id, pool.id, m, v)} className="num-input" />
                          </td>
                        ))}
                        <td rowSpan={2} className="alloc-actions-col">
                          <ConfirmButton label="Remove" onConfirm={() => { clearRequirementPool(project.id, pool.id); clearAssignmentPool(project.id, pool.id); }} />
                        </td>
                      </tr>
                      <tr>
                        <td className="alloc-kind-label">Assigned</td>
                        {months.map((m, i) => {
                          const required = staffingByMonth[i]?.required ?? 0;
                          const assigned = staffingByMonth[i]?.assigned ?? 0;
                          const short = required > 0 && assigned < required - 0.001;
                          return (
                            <td key={m} className={`alloc-cell ${short ? 'alloc-cell-short' : ''}`}>
                              <NumberField value={assigned} onCommit={(v) => setAssignment(project.id, pool.id, m, v)} className="num-input" />
                            </td>
                          );
                        })}
                      </tr>
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
