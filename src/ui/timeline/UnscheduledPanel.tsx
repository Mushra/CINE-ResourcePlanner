import { useState } from 'react';
import type { Project } from '../../domain/types';
import type { PlanningEngine } from '../../engine/planning';
import { Icon } from '../components/Icon';
import { todayPeriod, addMonths } from '../../domain/periods';

export function UnscheduledPanel({
  projects, engine, onOpen, onSetDates,
}: {
  projects: Project[];
  engine: PlanningEngine;
  onOpen: (projectId: string) => void;
  onSetDates: (project: Project, startDate: string, endDate: string) => void;
}) {
  return (
    <div className="tl-unscheduled">
      <div className="tl-unscheduled-title">
        <Icon name="calendar" size={13} />
        Unscheduled (TBD dates) — {projects.length} project{projects.length === 1 ? '' : 's'}
      </div>
      <div className="tl-unscheduled-list">
        {projects.map((project) => (
          <UnscheduledRow key={project.id} project={project} engine={engine} onOpen={onOpen} onSetDates={onSetDates} />
        ))}
      </div>
    </div>
  );
}

function UnscheduledRow({
  project, engine, onOpen, onSetDates,
}: {
  project: Project;
  engine: PlanningEngine;
  onOpen: (projectId: string) => void;
  onSetDates: (project: Project, startDate: string, endDate: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const poolCount = engine.projectPoolIds(project.id).length;

  if (picking) {
    const defaultStart = `${todayPeriod()}-01`;
    const defaultEnd = `${addMonths(todayPeriod(), 2)}-01`;
    return (
      <div className="tl-unscheduled-row tl-unscheduled-picking">
        <span className="tl-unscheduled-name">{project.name}</span>
        <input type="date" defaultValue={defaultStart} id={`start-${project.id}`} />
        <span className="tl-unscheduled-arrow">→</span>
        <input type="date" defaultValue={defaultEnd} id={`end-${project.id}`} />
        <button
          type="button"
          className="tl-unscheduled-confirm"
          onClick={() => {
            const start = (document.getElementById(`start-${project.id}`) as HTMLInputElement).value;
            const end = (document.getElementById(`end-${project.id}`) as HTMLInputElement).value;
            if (start && end && start <= end) onSetDates(project, start, end);
            setPicking(false);
          }}
        >
          Confirm
        </button>
        <button type="button" className="tl-unscheduled-cancel" onClick={() => setPicking(false)}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="tl-unscheduled-row">
      <button type="button" className="tl-unscheduled-name" onClick={() => onOpen(project.id)}>{project.name}</button>
      <span className={`priority-badge priority-${project.priority} tl-priority-badge`}>{project.priority}</span>
      <span className="tl-unscheduled-meta">{poolCount} discipline{poolCount === 1 ? '' : 's'} staffed</span>
      <button type="button" className="tl-unscheduled-set-dates" onClick={() => setPicking(true)}>
        <Icon name="calendar" size={12} /> Set dates
      </button>
    </div>
  );
}
