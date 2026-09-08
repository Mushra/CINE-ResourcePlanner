import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import type { DateCertainty, Priority, Project, ProjectStatus } from '../../domain/types';

export interface ProjectFormValue {
  name: string;
  status: ProjectStatus;
  priority: Priority;
  startDate: string | null;
  startCertainty: DateCertainty;
  endDate: string | null;
  endCertainty: DateCertainty;
  notes: string;
  isDispo: boolean;
}

function fromProject(project?: Project): ProjectFormValue {
  if (!project) {
    return { name: '', status: 'planned', priority: 'medium', startDate: null, startCertainty: 'estimated', endDate: null, endCertainty: 'estimated', notes: '', isDispo: false };
  }
  return {
    name: project.name,
    status: project.status,
    priority: project.priority,
    startDate: project.startDate,
    startCertainty: project.startCertainty,
    endDate: project.endDate,
    endCertainty: project.endCertainty,
    notes: project.notes,
    isDispo: project.isDispo,
  };
}

export function ProjectFormDrawer({ project, onClose, onSave }: { project?: Project; onClose: () => void; onSave: (value: ProjectFormValue) => void }) {
  const [value, setValue] = useState<ProjectFormValue>(() => fromProject(project));
  const [initialSnapshot] = useState(() => JSON.stringify(value));
  const canSave = value.name.trim().length > 0;
  const dirty = JSON.stringify(value) !== initialSnapshot;

  function set<K extends keyof ProjectFormValue>(key: K, v: ProjectFormValue[K]): void {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <Drawer title={project ? 'Edit project' : 'New project'} onClose={onClose} dirty={dirty}>
      <div className="field">
        <label htmlFor="proj-name">Name</label>
        <input id="proj-name" autoFocus value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Cinematic Alpha" />
        {project?.importName && project.importName !== value.name && (
          <p className="field-hint">Imported as "{project.importName}" — renaming here only changes the display name, a re-import will still match the original.</p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="proj-status">Status</label>
          <select id="proj-status" value={value.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="proj-priority">Priority</label>
          <select id="proj-priority" value={value.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <DateCertaintyField
        label="Start"
        date={value.startDate}
        certainty={value.startCertainty}
        onDateChange={(d) => set('startDate', d)}
        onCertaintyChange={(c) => set('startCertainty', c)}
      />
      <DateCertaintyField
        label="End"
        date={value.endDate}
        certainty={value.endCertainty}
        onDateChange={(d) => set('endDate', d)}
        onCertaintyChange={(c) => set('endCertainty', c)}
      />

      <div className="field">
        <label htmlFor="proj-notes">Notes</label>
        <textarea id="proj-notes" rows={4} value={value.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Context, dependencies, greenlight status…" />
      </div>

      <div className="field field-checkbox">
        <label htmlFor="proj-dispo">
          <input id="proj-dispo" type="checkbox" checked={value.isDispo} onChange={(e) => set('isDispo', e.target.checked)} />
          Projet dispo (placeholder)
        </label>
      </div>

      {value.startDate && value.endDate && value.startDate > value.endDate && (
        <div className="form-warning">End date is before the start date — fix this before saving.</div>
      )}

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!canSave || Boolean(value.startDate && value.endDate && value.startDate > value.endDate)}
          onClick={() => onSave(value)}
        >
          {project ? 'Save changes' : 'Create project'}
        </Button>
      </div>
    </Drawer>
  );
}

function DateCertaintyField({
  label, date, certainty, onDateChange, onCertaintyChange,
}: {
  label: string;
  date: string | null;
  certainty: DateCertainty;
  onDateChange: (d: string | null) => void;
  onCertaintyChange: (c: DateCertainty) => void;
}) {
  const id = `date-${label.toLowerCase()}`;
  return (
    <div className="field-row">
      <div className="field" style={{ flex: 1.3 }}>
        <label htmlFor={id}>{label} date</label>
        <input
          id={id}
          type="date"
          value={date ?? ''}
          disabled={certainty === 'tbd'}
          onChange={(e) => onDateChange(e.target.value || null)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-certainty`}>Certainty</label>
        <select
          id={`${id}-certainty`}
          value={certainty}
          onChange={(e) => {
            const next = e.target.value as DateCertainty;
            onCertaintyChange(next);
            if (next === 'tbd') onDateChange(null);
          }}
        >
          <option value="confirmed">Confirmed</option>
          <option value="estimated">Estimated</option>
          <option value="tbd">TBD</option>
        </select>
      </div>
    </div>
  );
}
