import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { buildJiraToleranceMap, getSanityChecks, type SanityCheck } from '../../engine/validation';
import {
  HEALTH_LABEL, deriveLoqHealth, loqStatusLabel, projectAttention, representativeLoq, worstDiscipline,
  type AttentionItem, type WatchtowerHealth,
} from '../../engine/watchtower';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmptyState } from '../components/EmptyState';
import { CinematicFormDrawer, type CinematicFormValue } from '../components/CinematicFormDrawer';
import { LoqFormDrawer, type LoqFormValue } from '../components/LoqFormDrawer';
import { LoqTimeline } from '../components/LoqTimeline';
import { RecommitDialog } from '../components/RecommitDialog';
import { VarianceDialog } from '../components/VarianceDialog';
import type { Loq } from '../../domain/types';

const LOQ_STATUS_LABEL: Record<Loq['status'], string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };
const SEVERITY_RANK: Record<SanityCheck['severity'], number> = { critical: 2, warning: 1, info: 0 };

const VERSION_PLAYER_GAP = "Needs a ShotGrid/Flow connector to fetch and stream published review versions, and to expose the publish/push event log.";
const HOTLINES_GAP = "Needs a Hotline/escalation feed integration — no domain model exists yet.";
const QA_BUGS_GAP = "Needs a QA bug tracker integration (e.g. ShotGrid Notes/Tickets, or a dedicated bug DB) — no domain model exists yet.";

export function CinematicDetail({ cinematicId }: { cinematicId: string }) {
  const cinematic = useStore((s) => s.data.cinematics.find((c) => c.id === cinematicId));
  const project = useStore((s) => s.data.projects.find((p) => p.id === cinematic?.projectId));
  const engine = useStore((s) => s.engine);
  const jiraConfigs = useStore((s) => s.jiraConfigs);
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
  const [recommitTarget, setRecommitTarget] = useState<{ loq: Loq; initialStart: string | null; initialFinish: string | null } | null>(null);
  const [varianceTarget, setVarianceTarget] = useState<Loq | null>(null);
  const [focus, setFocus] = useState<string>('ALL');

  if (!cinematic) {
    return (
      <div className="cinematic-detail-view">
        <button type="button" className="back-link" onClick={backToProject}><Icon name="arrow-left" size={14} /> Back to project</button>
        <p>This cinematic no longer exists.</p>
      </div>
    );
  }

  const cinematicLoqs = loqs.filter((l) => l.cinematicId === cinematic.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const disciplineIds = disciplines.map((d) => d.id);
  const forecasts = engine.getLoqForecasts();

  const checks = project ? getSanityChecks(engine, buildJiraToleranceMap(jiraConfigs)).filter((c) => c.projectId === project.id) : [];
  const cinematicAttention: AttentionItem[] = project
    ? projectAttention(engine, checks, project.id)
      .filter((item) => item.cinematicId === cinematic.id && item.source !== 'Production Planning')
      .filter((item) => focus === 'ALL' || item.check.disciplineId === focus)
      .sort((a, b) => SEVERITY_RANK[b.check.severity] - SEVERITY_RANK[a.check.severity])
    : [];

  const focusDisciplineId = focus !== 'ALL' ? focus : worstDiscipline(cinematic.id, disciplineIds, loqs, forecasts);
  const focusDisciplineName = focusDisciplineId ? disciplines.find((d) => d.id === focusDisciplineId)?.name ?? focusDisciplineId : null;
  const focusLoq = focusDisciplineId ? representativeLoq(loqs, cinematic.id, focusDisciplineId) : null;
  const focusHealth: WatchtowerHealth | null = focusLoq ? deriveLoqHealth(focusLoq, forecasts.get(focusLoq.id)) : null;
  const focusForecastFinish = focusLoq ? forecasts.get(focusLoq.id)?.forecastFinish ?? focusLoq.actualFinish ?? null : null;

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

      <div className="discipline-tabs">
        <button type="button" className={`discipline-tab ${focus === 'ALL' ? 'active' : ''}`} onClick={() => setFocus('ALL')}>All</button>
        {disciplines.map((d) => (
          <button key={d.id} type="button" className={`discipline-tab ${focus === d.id ? 'active' : ''}`} onClick={() => setFocus(d.id)}>{d.name}</button>
        ))}
      </div>

      <div className="card panel">
        <div className="panel-header">
          <h2>Attention</h2>
          <span className="panel-sub">{cinematicAttention.length} issue{cinematicAttention.length === 1 ? '' : 's'} for this cinematic{focus !== 'ALL' && focusDisciplineName ? ` — ${focusDisciplineName}` : ''}</span>
        </div>
        {cinematicAttention.length === 0 ? (
          <p className="empty-inline">No attention items{focus !== 'ALL' && focusDisciplineName ? ` for ${focusDisciplineName}` : ''}.</p>
        ) : (
          <ul className="issue-list">
            {cinematicAttention.map((item) => {
              const linkedLoq = item.check.loqId ? cinematicLoqs.find((l) => l.id === item.check.loqId) : undefined;
              return (
                <li key={item.check.id} className="issue-row">
                  <Icon name="warning" size={14} />
                  <div className="issue-body">
                    <button
                      type="button"
                      className="issue-message"
                      disabled={!linkedLoq}
                      onClick={() => linkedLoq && setEditingLoq(linkedLoq)}
                    >
                      {item.check.disciplineName ? `${item.check.disciplineName} — ` : ''}{item.check.message}
                    </button>
                    <div className="issue-impact">{item.check.impact} · <span className="tbd-inline">{item.source}</span></div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="cd-grid2">
        <div className="card panel">
          <div className="panel-header">
            <h2>Latest version</h2>
          </div>
          <EmptyState icon="info" title="Not available yet" description={VERSION_PLAYER_GAP} compact />
        </div>
        <div className="card panel">
          <div className="panel-header">
            <h2>Production</h2>
            <span className="panel-sub">{focusDisciplineName ?? 'No discipline yet'}</span>
          </div>
          {focusLoq ? (
            <div className="kv-rows">
              <div className="kv-row"><span className="k">Current LOQ</span><span className="v">{focusLoq.type}</span></div>
              <div className="kv-row"><span className="k">Status</span><span className="v">{loqStatusLabel(focusLoq)}</span></div>
              {focusHealth && (
                <div className="kv-row"><span className="k">Health</span><span className={`v health-text health-text-${focusHealth}`}>{HEALTH_LABEL[focusHealth]}</span></div>
              )}
              <div className="kv-row">
                <span className="k">Committed window</span>
                <span className="v">{focusLoq.committedStart ? `${focusLoq.committedStart} → ${focusLoq.committedFinish ?? '…'}` : 'Unscheduled'}</span>
              </div>
              <div className="kv-row"><span className="k">Forecast finish</span><span className="v">{focusForecastFinish ?? '—'}</span></div>
            </div>
          ) : (
            <p className="empty-inline">No LOQ yet{focusDisciplineName ? ` for ${focusDisciplineName}` : ''}.</p>
          )}
        </div>
      </div>

      <div className="card panel">
        <div className="panel-header">
          <h2>Hotlines</h2>
        </div>
        <EmptyState icon="info" title="Not available yet" description={HOTLINES_GAP} compact />
      </div>

      <div className="card panel">
        <div className="panel-header">
          <h2>QA bugs</h2>
        </div>
        <EmptyState icon="info" title="Not available yet" description={QA_BUGS_GAP} compact />
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
                        <Button variant="ghost" size="sm" icon="warning" onClick={() => setVarianceTarget(loq)}>Variance</Button>
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

      {cinematicLoqs.length > 0 && (
        <div className="card timeline-card">
          <div className="panel-header">
            <h2>Schedule</h2>
            <span className="panel-sub">Drag to move or resize committed windows and person assignments</span>
          </div>
          <LoqTimeline
            cinematicId={cinematic.id}
            onEditLoq={setEditingLoq}
            onRecommit={(loq, initialStart, initialFinish) => setRecommitTarget({ loq, initialStart, initialFinish })}
          />
        </div>
      )}

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
            createLoq({ cinematicId: cinematic.id, ...value, actualFinish: null, committedStart: null, committedFinish: null });
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
          onRecommit={() => {
            setRecommitTarget({ loq: editingLoq, initialStart: editingLoq.committedStart, initialFinish: editingLoq.committedFinish });
            setEditingLoq(null);
          }}
        />
      )}

      {recommitTarget && (
        <RecommitDialog
          loq={recommitTarget.loq}
          initialStart={recommitTarget.initialStart}
          initialFinish={recommitTarget.initialFinish}
          onClose={() => setRecommitTarget(null)}
        />
      )}

      {varianceTarget && (
        <VarianceDialog loq={varianceTarget} onClose={() => setVarianceTarget(null)} />
      )}
    </div>
  );
}
