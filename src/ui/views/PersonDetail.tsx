import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { todayPeriod } from '../../domain/periods';
import { buildTimelineWindow } from '../timeline/timelineMath';
import { isGenericPoolName } from '../../domain/identity';
import { deriveProjectStatus, STATUS_LABEL } from '../../domain/projectStatus';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ConfirmButton } from '../components/ConfirmButton';
import { PersonFormDrawer, type PersonFormValue } from '../components/PersonFormDrawer';
import { usePersonSave } from '../hooks/usePersonSave';

const MONTH_W = 34;

export function PersonDetail({ personId }: { personId: string }) {
  const person = useStore((s) => s.data.people.find((p) => p.id === personId));
  const engine = useStore((s) => s.engine);
  const pools = useStore((s) => s.data.pools);
  const disciplines = useStore((s) => s.data.disciplines);
  const projects = useStore((s) => s.data.projects);
  const deletePerson = useStore((s) => s.deletePerson);
  const backToTeam = useUiStore((s) => s.backToTeam);
  const openProject = useUiStore((s) => s.openProject);
  const { savePersonEdit } = usePersonSave();
  const [editing, setEditing] = useState(false);

  if (!person) {
    return (
      <div className="person-detail-view">
        <button type="button" className="back-link" onClick={backToTeam}><Icon name="arrow-left" size={14} /> Back to team</button>
        <p>This person no longer exists.</p>
      </div>
    );
  }

  const pool = pools.find((p) => p.id === person.poolId);
  const discipline = disciplines.find((d) => d.id === person.effectiveDisciplineId);
  const visiblePools = pools.filter((p) => !isGenericPoolName(p.name));
  const period = todayPeriod();
  const assignedNow = engine.getPersonAssigned(person.id, period);

  const projectById = new Map(projects.map((p) => [p.id, p] as const));
  const window = buildTimelineWindow(engine.personAllocatedPeriods(person.id));
  const rows = new Map<string, { name: string; status: string; fte: number[] }>();
  window.forEach((p, idx) => {
    for (const line of engine.getPersonProjectStaffing(person.id, p)) {
      if (!rows.has(line.projectId)) {
        const project = projectById.get(line.projectId);
        const status = project ? deriveProjectStatus(project) : line.projectStatus;
        rows.set(line.projectId, { name: line.projectName, status, fte: window.map(() => 0) });
      }
      rows.get(line.projectId)!.fte[idx] = line.fte;
    }
  });
  const projectRows = [...rows.entries()]
    .filter(([, r]) => r.fte.some((v) => Math.abs(v) > 0.001))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  return (
    <div className="person-detail-view">
      <button type="button" className="back-link" onClick={backToTeam}><Icon name="arrow-left" size={14} /> Back to team</button>

      <div className="card detail-header">
        <div className="detail-header-top">
          <div>
            <h1>{person.name}</h1>
            <div className="detail-meta">
              <span className={`status-dot ${person.active ? 'status-active' : 'status-cancelled'}`} />
              <span>{person.active ? 'Active' : 'Inactive'}</span>
              <span className="meta-sep">·</span>
              <span>{pool?.name ?? 'Unassigned role'}</span>
              <span className="meta-sep">·</span>
              <span>{discipline?.name ?? 'Unassigned'}</span>
              {person.team && (<><span className="meta-sep">·</span><span>{person.team}</span></>)}
              {person.site && (<><span className="meta-sep">·</span><span>{person.site}</span></>)}
            </div>
          </div>
          <div className="detail-header-actions">
            <Button variant="secondary" icon="edit" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            <ConfirmButton label="Delete" onConfirm={() => { deletePerson(person.id); backToTeam(); }} />
          </div>
        </div>

        <div className="detail-dates">
          <div className="date-chip">
            <span className="date-chip-label">Capacity</span>
            <span className="date-chip-value">{person.capacityFte} FTE</span>
          </div>
          <div className="date-chip">
            <span className="date-chip-label">Assigned now</span>
            <span className="date-chip-value">{assignedNow} FTE</span>
          </div>
        </div>

        {person.notes && <p className="detail-notes">{person.notes}</p>}
      </div>

      <div className="card requirements-card">
        <div className="panel-header">
          <h2>Assignment timeline</h2>
          <span className="panel-sub">Projects this person is staffed on, by month</span>
        </div>

        {projectRows.length === 0 ? (
          <p className="empty-inline">Not assigned to any project.</p>
        ) : (
          <div className="person-timeline">
            <div className="person-timeline-header" style={{ gridTemplateColumns: `160px repeat(${window.length}, ${MONTH_W}px)` }}>
              <div className="req-timeline-corner" />
              {window.map((p) => <div key={p} className="req-timeline-month">{p}</div>)}
            </div>
            <div className="person-timeline-rows">
              {projectRows.map(([projectId, row]) => (
                <div key={projectId} className="person-timeline-row">
                  <div className="person-timeline-label">
                    <button type="button" className="person-name-link" onClick={() => openProject(projectId)}>{row.name}</button>
                    <span className={`status-dot status-${row.status}`} title={STATUS_LABEL[row.status as keyof typeof STATUS_LABEL] ?? row.status} />
                  </div>
                  <div className="person-timeline-track" style={{ width: window.length * MONTH_W }}>
                    {window.map((p, i) => (
                      <div key={p} className="person-timeline-cell" style={{ left: i * MONTH_W, width: MONTH_W }}>
                        {row.fte[i] > 0.001 && <span>{row.fte[i]}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {editing && (
        <PersonFormDrawer
          person={person}
          pools={visiblePools}
          disciplines={disciplines}
          onClose={() => setEditing(false)}
          onSave={(v: PersonFormValue) => { savePersonEdit(person, v); setEditing(false); }}
        />
      )}
    </div>
  );
}
