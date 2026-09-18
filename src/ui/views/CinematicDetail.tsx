import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ConfirmButton } from '../components/ConfirmButton';
import { CinematicFormDrawer, type CinematicFormValue } from '../components/CinematicFormDrawer';
import { LoqFormDrawer, type LoqFormValue } from '../components/LoqFormDrawer';
import type { Loq } from '../../domain/types';

const LOQ_STATUS_LABEL: Record<Loq['status'], string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };

export function CinematicDetail({ cinematicId }: { cinematicId: string }) {
  const cinematic = useStore((s) => s.data.cinematics.find((c) => c.id === cinematicId));
  const project = useStore((s) => s.data.projects.find((p) => p.id === cinematic?.projectId));
  const disciplines = useStore((s) => s.data.disciplines);
  const loqs = useStore((s) => s.data.loqs);
  const updateCinematic = useStore((s) => s.updateCinematic);
  const deleteCinematic = useStore((s) => s.deleteCinematic);
  const createLoq = useStore((s) => s.createLoq);
  const updateLoq = useStore((s) => s.updateLoq);
  const deleteLoq = useStore((s) => s.deleteLoq);
  const backToProject = useUiStore((s) => s.backToProject);
  const [editing, setEditing] = useState(false);
  const [newLoq, setNewLoq] = useState(false);
  const [editingLoq, setEditingLoq] = useState<Loq | null>(null);

  if (!cinematic) {
    return (
      <div className="cinematic-detail-view">
        <button type="button" className="back-link" onClick={backToProject}><Icon name="arrow-left" size={14} /> Back to project</button>
        <p>This cinematic no longer exists.</p>
      </div>
    );
  }

  const cinematicLoqs = loqs.filter((l) => l.cinematicId === cinematic.id).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="cinematic-detail-view">
      <button type="button" className="back-link" onClick={backToProject}><Icon name="arrow-left" size={14} /> Back to {project?.name ?? 'project'}</button>

      <div className="card detail-header">
        <div className="detail-header-top">
          <div>
            <h1>{cinematic.name}</h1>
            <div className="detail-meta">
              <span>Target: {cinematic.targetDate ?? 'TBD'}</span>
            </div>
          </div>
          <div className="detail-header-actions">
            <Button variant="secondary" icon="edit" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            <ConfirmButton label="Delete" onConfirm={() => { deleteCinematic(cinematic.id); backToProject(); }} />
          </div>
        </div>

        {cinematic.notes && <p className="detail-notes">{cinematic.notes}</p>}
      </div>

      <div className="card loqs-card">
        <div className="panel-header">
          <h2>LOQs</h2>
          <span className="panel-sub">Day-level milestones for this cinematic</span>
          <div className="panel-header-toggles">
            <Button variant="primary" size="sm" icon="plus" onClick={() => setNewLoq(true)}>New LOQ</Button>
          </div>
        </div>

        {cinematicLoqs.length === 0 ? (
          <p className="empty-inline">No LOQs yet. Add one to start scheduling this cinematic.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Discipline</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Estimate</th>
                  <th>Committed window</th>
                  <th>Jira</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cinematicLoqs.map((loq) => {
                  const discipline = disciplines.find((d) => d.id === loq.disciplineId);
                  return (
                    <tr key={loq.id}>
                      <td>{discipline?.name ?? 'Unassigned'}</td>
                      <td className="cell-name">{loq.type}</td>
                      <td><span className={`loq-status loq-status-${loq.status.toLowerCase()}`}>{LOQ_STATUS_LABEL[loq.status]}</span></td>
                      <td>{loq.estimateDays ?? <span className="tbd-text">—</span>}</td>
                      <td>
                        {loq.committedStart
                          ? `${loq.committedStart} → ${loq.committedFinish ?? '…'}`
                          : <span className="tbd-text">Unscheduled</span>}
                      </td>
                      <td>{loq.jiraKey ?? <span className="tbd-text">—</span>}</td>
                      <td className="cell-actions">
                        <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditingLoq(loq)}>Edit</Button>
                        <ConfirmButton label="Delete" onConfirm={() => deleteLoq(loq.id)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <CinematicFormDrawer
          cinematic={cinematic}
          onClose={() => setEditing(false)}
          onSave={(value: CinematicFormValue) => {
            updateCinematic({ ...cinematic, ...value });
            setEditing(false);
          }}
        />
      )}

      {newLoq && (
        <LoqFormDrawer
          disciplines={disciplines}
          onClose={() => setNewLoq(false)}
          onSave={(value: LoqFormValue) => {
            createLoq({ cinematicId: cinematic.id, ...value, actualFinish: null });
            setNewLoq(false);
          }}
        />
      )}

      {editingLoq && (
        <LoqFormDrawer
          loq={editingLoq}
          disciplines={disciplines}
          onClose={() => setEditingLoq(null)}
          onSave={(value: LoqFormValue) => {
            updateLoq({ ...editingLoq, ...value });
            setEditingLoq(null);
          }}
        />
      )}
    </div>
  );
}
