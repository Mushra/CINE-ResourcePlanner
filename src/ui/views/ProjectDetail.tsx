import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { getSanityChecks } from '../../engine/validation';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ConfirmButton } from '../components/ConfirmButton';
import { ProjectFormDrawer, type ProjectFormValue } from '../components/ProjectFormDrawer';
import { deriveProjectStatus, STATUS_LABEL } from '../../domain/projectStatus';
import { ControlRoom } from './watchtower/ControlRoom';
import { CinematicsMatrix } from './watchtower/CinematicsMatrix';
import { StaffingView } from './watchtower/StaffingView';

const CERTAINTY_LABEL: Record<string, string> = { confirmed: 'Confirmed', estimated: 'Estimated', tbd: 'TBD' };

/**
 * Watchtower's per-project shell: header + the Production/Staffing switch. Production reproduces
 * the prototype's Control Room / Cinematics Matrix screens on real engine data; Staffing is the
 * pre-existing requirement/assignment timeline (StaffingView) plus staffing-scoped warnings.
 * Project-scoped `checks` are split by source (see engine/watchtower.ts::attentionSource) rather
 * than shown together in one header panel — planning issues in Control Room, staffing/FTE issues
 * in Staffing. See docs/WATCHTOWER.md.
 */
export function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.data.projects.find((p) => p.id === projectId));
  const engine = useStore((s) => s.engine);
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const backToProjects = useUiStore((s) => s.backToProjects);
  const projectView = useUiStore((s) => s.projectView);
  const setProjectView = useUiStore((s) => s.setProjectView);
  const productionScreen = useUiStore((s) => s.productionScreen);
  const setProductionScreen = useUiStore((s) => s.setProductionScreen);
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

  return (
    <div className="project-detail-view">
      <button type="button" className="back-link" onClick={backToProjects}><Icon name="arrow-left" size={14} /> Back to projects</button>

      <div className="card detail-header">
        <div className="detail-header-top">
          <div>
            <h1>{project.name}</h1>
            <div className="detail-meta">
              <span className={`status-dot status-${deriveProjectStatus(project)}`} />
              <span>{STATUS_LABEL[deriveProjectStatus(project)]}</span>
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

        <div className="detail-view-switch">
          <div className="segmented">
            <button type="button" className={projectView === 'production' ? 'active' : ''} onClick={() => setProjectView('production')}>Production</button>
            <button type="button" className={projectView === 'staffing' ? 'active' : ''} onClick={() => setProjectView('staffing')}>Staffing</button>
          </div>
          {projectView === 'production' && (
            <div className="segmented segmented-sm">
              <button type="button" className={productionScreen === 'control' ? 'active' : ''} onClick={() => setProductionScreen('control')}>Control Room</button>
              <button type="button" className={productionScreen === 'matrix' ? 'active' : ''} onClick={() => setProductionScreen('matrix')}>Cinematics Matrix</button>
            </div>
          )}
        </div>
      </div>

      {projectView === 'staffing' ? (
        <StaffingView project={project} checks={checks} />
      ) : productionScreen === 'control' ? (
        <ControlRoom project={project} checks={checks} />
      ) : (
        <CinematicsMatrix project={project} checks={checks} />
      )}

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
