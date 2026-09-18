import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ConfirmButton } from '../components/ConfirmButton';
import { CinematicFormDrawer, type CinematicFormValue } from '../components/CinematicFormDrawer';

export function CinematicDetail({ cinematicId }: { cinematicId: string }) {
  const cinematic = useStore((s) => s.data.cinematics.find((c) => c.id === cinematicId));
  const project = useStore((s) => s.data.projects.find((p) => p.id === cinematic?.projectId));
  const updateCinematic = useStore((s) => s.updateCinematic);
  const deleteCinematic = useStore((s) => s.deleteCinematic);
  const backToProject = useUiStore((s) => s.backToProject);
  const [editing, setEditing] = useState(false);

  if (!cinematic) {
    return (
      <div className="cinematic-detail-view">
        <button type="button" className="back-link" onClick={backToProject}><Icon name="arrow-left" size={14} /> Back to project</button>
        <p>This cinematic no longer exists.</p>
      </div>
    );
  }

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
        </div>
        <p className="empty-inline">LOQ list and the day timeline are coming in the next slice.</p>
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
    </div>
  );
}
