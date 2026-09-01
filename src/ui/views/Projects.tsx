import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { getSanityChecks } from '../../engine/validation';
import { periodRange, periodFromISODate } from '../../domain/periods';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { StatusPill } from '../components/StatusPill';
import { Icon } from '../components/Icon';
import { ProjectFormDrawer, type ProjectFormValue } from '../components/ProjectFormDrawer';
import type { Priority } from '../../domain/types';

const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled',
};

export function Projects() {
  const projects = useStore((s) => s.data.projects);
  const engine = useStore((s) => s.engine);
  const createProject = useStore((s) => s.createProject);
  const openProject = useUiStore((s) => s.openProject);
  const [showNew, setShowNew] = useState(false);

  const checks = useMemo(() => getSanityChecks(engine), [engine]);
  const checksByProject = useMemo(() => {
    const map = new Map<string, typeof checks>();
    for (const check of checks) {
      if (!check.projectId) continue;
      map.set(check.projectId, [...(map.get(check.projectId) ?? []), check]);
    }
    return map;
  }, [checks]);

  const sorted = [...projects].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.name.localeCompare(b.name));

  return (
    <div className="projects-view">
      <div className="view-header">
        <div>
          <h1>Projects</h1>
          <p className="view-sub">{projects.length} project{projects.length === 1 ? '' : 's'} in the portfolio</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>New project</Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon="projects"
          title="No projects yet"
          description="Create your first project to start planning resources."
          action={<Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>New project</Button>}
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Start</th>
              <th>End</th>
              <th>Duration</th>
              <th>Staffing health</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((project) => {
              const projectChecks = checksByProject.get(project.id) ?? [];
              const months = periodRange(periodFromISODate(project.startDate), periodFromISODate(project.endDate)).length;
              const isTbd = project.startCertainty === 'tbd' || project.endCertainty === 'tbd';
              return (
                <tr key={project.id} className="clickable-row" onClick={() => openProject(project.id)}>
                  <td className="cell-name">{project.name}</td>
                  <td><span className={`status-dot status-${project.status}`} />{STATUS_LABEL[project.status]}</td>
                  <td><PriorityBadge priority={project.priority} /></td>
                  <td>{project.startDate ?? <span className="tbd-text">TBD</span>}</td>
                  <td>{project.endDate ?? <span className="tbd-text">TBD</span>}</td>
                  <td>{months > 0 ? `${months} mo` : '—'}</td>
                  <td><HealthBadge checks={projectChecks} isTbd={isTbd} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

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

function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`priority-badge priority-${priority}`}>{priority}</span>;
}

function HealthBadge({ checks, isTbd }: { checks: { severity: string; category: string }[]; isTbd: boolean }) {
  const dateIssues = checks.filter((c) => c.category === 'invalid_dates');
  const staffingIssues = checks.filter((c) => c.category === 'understaffed_project' || c.category === 'unstaffed_requirement');
  const hasCriticalDates = dateIssues.some((c) => c.severity === 'critical');
  const hasCriticalStaffing = staffingIssues.some((c) => c.severity === 'critical');

  return (
    <div className="health-cell">
      {hasCriticalDates ? (
        <StatusPill tone="critical">Invalid dates</StatusPill>
      ) : hasCriticalStaffing ? (
        <StatusPill tone="critical">Understaffed</StatusPill>
      ) : staffingIssues.length > 0 ? (
        <StatusPill tone="warning">Understaffed</StatusPill>
      ) : dateIssues.length > 0 ? (
        <StatusPill tone="warning">Date issue</StatusPill>
      ) : (
        <StatusPill tone="neutral">Healthy</StatusPill>
      )}
      {isTbd && <span className="tbd-inline"><Icon name="calendar" size={11} /> TBD dates</span>}
    </div>
  );
}
