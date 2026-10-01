import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { getSanityChecks } from '../../engine/validation';
import {
  HEALTH_LABEL, buildEffectiveStatusMap, deriveLoqHealth, projectAttention,
  statusResolverFrom, type AttentionItem,
} from '../../engine/watchtower';
import { impactedLoqIds } from '../../engine/loqForecast';
import {
  CANONICAL_STATUSES, CANONICAL_STATUS_LABEL, UNMAPPED, type EffectiveStatus,
} from '../../domain/jiraStatusMap';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ConfirmButton } from '../components/ConfirmButton';
import { RecommitDialog } from '../components/RecommitDialog';
import { VarianceDialog } from '../components/VarianceDialog';
import { LoqDependencyEditor } from '../components/LoqDependencyEditor';
import type { Loq, LoqStatus } from '../../domain/types';

const STATUS_OPTIONS: { value: LoqStatus; label: string }[] = CANONICAL_STATUSES.map((value) => ({
  value, label: CANONICAL_STATUS_LABEL[value],
}));

/** Status cell for a LOQ, honouring its effective (Jira-mirrored) status — same rule as the Matrix
 * and Cinematic Detail: a voluntary pause reads "On hold", a bound-but-unmapped Jira status reads
 * "À mapper", otherwise the canonical label. */
function loqStatusCell(loq: Loq, effective: EffectiveStatus | undefined): { className: string; label: string } {
  if (loq.paused) return { className: 'loq-status-on-hold', label: 'On hold' };
  const eff = effective ?? loq.status;
  if (eff === UNMAPPED) return { className: 'loq-status-unmapped', label: 'À mapper' };
  return { className: `loq-status-${eff.toLowerCase()}`, label: CANONICAL_STATUS_LABEL[eff] };
}

/** Deep-link to a single issue's page. */
function jiraBrowseUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/browse/${key}`;
}

interface Draft {
  disciplineId: string;
  jiraKey: string | null;
  type: string;
  status: LoqStatus;
  estimateDays: number | null;
  dodRef: string;
  paused: boolean;
}

function draftFromLoq(loq: Loq): Draft {
  return {
    disciplineId: loq.disciplineId,
    jiraKey: loq.jiraKey,
    type: loq.type,
    status: loq.status,
    estimateDays: loq.estimateDays,
    dodRef: loq.dodRef,
    paused: loq.paused,
  };
}

/**
 * Dedicated page for a single LOQ — recreates the HTML prototype's LOQ view (breadcrumb, status
 * header, "why at risk", downstream-dependency graph, execution facts) plus inline editing that
 * replaces the old LoqFormDrawer. Reachable from the Cinematics Matrix cell and the Cinematic Detail
 * LOQ table (both call openLoq). Jira-bound status is mirrored read-only; committed dates change only
 * via the attributed RecommitDialog; forecast gaps are declared via VarianceDialog.
 */
export function LoqDetail({ loqId }: { loqId: string }) {
  const loq = useStore((s) => s.data.loqs.find((l) => l.id === loqId));
  const cinematic = useStore((s) => s.data.cinematics.find((c) => c.id === loq?.cinematicId));
  const project = useStore((s) => s.data.projects.find((p) => p.id === cinematic?.projectId));
  const engine = useStore((s) => s.engine);
  const jiraConfigs = useStore((s) => s.jiraConfigs);
  const disciplines = useStore((s) => s.data.disciplines);
  const loqs = useStore((s) => s.data.loqs);
  const dependencies = useStore((s) => s.data.loqDependencies);
  const commitmentEvents = useStore((s) => s.data.loqCommitmentEvents);
  const varianceEvents = useStore((s) => s.data.varianceEvents);
  const updateLoq = useStore((s) => s.updateLoq);
  const deleteLoq = useStore((s) => s.deleteLoq);
  const refreshCinematicView = useStore((s) => s.refreshCinematicView);

  const navigate = useUiStore((s) => s.navigate);
  const openProject = useUiStore((s) => s.openProject);
  const openCinematic = useUiStore((s) => s.openCinematic);
  const openLoq = useUiStore((s) => s.openLoq);
  const backToCinematic = useUiStore((s) => s.backToCinematic);

  const [draft, setDraft] = useState<Draft>(() => (loq ? draftFromLoq(loq) : {
    disciplineId: '', jiraKey: null, type: '', status: 'TODO', estimateDays: null, dodRef: '', paused: false,
  }));
  const [recommitOpen, setRecommitOpen] = useState(false);
  const [varianceOpen, setVarianceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const cinematicId = loq?.cinematicId;
  // Live-refresh the owning cinematic on open — mirrors CinematicDetail so the Jira-mirrored status is
  // current without a full project sync. Guarded/silent in a browser tab.
  useEffect(() => {
    if (cinematicId) void refreshCinematicView(cinematicId);
  }, [cinematicId, refreshCinematicView]);

  if (!loq) {
    return (
      <div className="loq-detail-view">
        <button type="button" className="back-link" onClick={backToCinematic}><Icon name="arrow-left" size={14} /> Back</button>
        <p>This LOQ no longer exists.</p>
      </div>
    );
  }

  const discipline = disciplines.find((d) => d.id === loq.disciplineId);
  const disciplineName = (id: string) => disciplines.find((d) => d.id === id)?.name ?? 'Unassigned';
  const loqLabel = `${disciplineName(loq.disciplineId)} ${loq.type}`.trim();

  const forecasts = engine.getLoqForecasts();
  const effectiveStatusMap = buildEffectiveStatusMap(engine, jiraConfigs);
  const statusOf = statusResolverFrom(effectiveStatusMap);
  const effectiveStatus = effectiveStatusMap.get(loq.id) ?? null;
  const statusCell = loqStatusCell(loq, effectiveStatus ?? undefined);
  const health = deriveLoqHealth(loq, forecasts.get(loq.id), statusOf(loq));
  const jiraConfig = project ? jiraConfigs.find((c) => c.projectId === project.id) ?? null : null;

  // "Why at risk" — every sanity check that names this LOQ, with its source label (keep all sources,
  // unlike CinematicDetail which hides Production Planning).
  const reasons: AttentionItem[] = project
    ? projectAttention(engine, getSanityChecks(engine, jiraConfigs).filter((c) => c.projectId === project.id), project.id)
      .filter((item) => item.check.loqId === loq.id)
    : [];

  // Downstream dependencies — direct successors, flagged AFFECTED when this LOQ is the root cause of
  // their forecast slip.
  const impacted = new Set(impactedLoqIds(loq.id, forecasts));
  const successors = dependencies
    .filter((d) => d.predecessorLoqId === loq.id)
    .map((d) => loqs.find((l) => l.id === d.successorLoqId))
    .filter((l): l is Loq => Boolean(l));

  const canSave = draft.disciplineId.trim().length > 0 && draft.type.trim().length > 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFromLoq(loq));
  function setField<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }
  function save(): void {
    if (!loq) return;
    updateLoq({ ...loq, ...draft });
  }

  const cinematicLoqs = loqs.filter((l) => l.cinematicId === loq.cinematicId);
  const commitmentHistory = commitmentEvents.filter((e) => e.loqId === loq.id).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const varianceHistory = varianceEvents.filter((e) => e.loqId === loq.id).sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));

  return (
    <div className="loq-detail-view">
      <nav className="loq-breadcrumb">
        <button type="button" onClick={() => navigate('projects')}>Projects</button>
        {project && <><span className="loq-crumb-sep">/</span><button type="button" onClick={() => openProject(project.id)}>{project.name}</button></>}
        {project && <><span className="loq-crumb-sep">/</span><button type="button" onClick={() => openProject(project.id)}>Cinematics</button></>}
        {cinematic && <><span className="loq-crumb-sep">/</span><button type="button" onClick={() => openCinematic(cinematic.id)}>{cinematic.name}</button></>}
        <span className="loq-crumb-sep">/</span><span className="loq-crumb-current">{loqLabel}</span>
      </nav>

      <button type="button" className="back-link" onClick={backToCinematic}><Icon name="arrow-left" size={14} /> Back to {cinematic?.name ?? 'cinematic'}</button>

      <div className="card detail-header">
        <h1 className="loq-title">{loqLabel}</h1>
        <div className="detail-meta">
          <span>{cinematic?.name ?? '—'}{cinematic?.notes ? ` · ${cinematic.notes}` : ''}</span>
        </div>
        <div className="loq-subtitle">{discipline?.name ?? 'Unassigned'}</div>
        <div className="loq-badges">
          <span className={`health-text health-text-${health}`}>{HEALTH_LABEL[health]}</span>
          <span className={`loq-status ${statusCell.className}`}>{statusCell.label}</span>
        </div>
      </div>

      {reasons.length > 0 && (
        <div className="card panel">
          <div className="panel-header"><h2>Why is this LOQ at risk?</h2></div>
          <ul className="issue-list">
            {reasons.map((item) => (
              <li key={item.check.id} className="issue-row">
                <Icon name="warning" size={14} />
                <div className="issue-body">
                  <div className="issue-message-static">{item.check.message}</div>
                  <div className="issue-impact">{item.check.impact} · <span className="tbd-inline">{item.source}</span></div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card panel">
        <div className="panel-header">
          <h2>Dependencies</h2>
          <span className="panel-sub">Direct dependencies and affected LOQs</span>
        </div>
        <div className="loq-dep-graph">
          <div className="loq-dep-node loq-dep-node-current">
            <div className="loq-dep-name">{loqLabel}</div>
            <div className={`health-text health-text-${health}`}>{HEALTH_LABEL[health]}</div>
            <div className="loq-dep-tag">Current LOQ</div>
          </div>
          {successors.length > 0 && (
            <>
              <div className="loq-dep-arrow"><Icon name="arrow-left" size={14} /><span>Downstream</span></div>
              <div className="loq-dep-row">
                {successors.map((succ) => {
                  const succHealth = deriveLoqHealth(succ, forecasts.get(succ.id), statusOf(succ));
                  return (
                    <button key={succ.id} type="button" className="loq-dep-node loq-dep-node-affected" onClick={() => openLoq(succ.id, succ.cinematicId)}>
                      <div className="loq-dep-name">{disciplineName(succ.disciplineId)} {succ.type}</div>
                      <div className={`health-text health-text-${succHealth}`}>{HEALTH_LABEL[succHealth]}</div>
                      {impacted.has(succ.id) && <div className="loq-dep-tag loq-dep-tag-affected">Affected</div>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {successors.length === 0 && <p className="empty-inline">No downstream LOQs depend on this one.</p>}
        </div>
      </div>

      <div className="card panel">
        <div className="panel-header"><h2>Execution</h2></div>
        <div className="kv-rows">
          <div className="kv-row"><span className="k">Status</span><span className="v">{statusCell.label}</span></div>
          <div className="kv-row"><span className="k">Health</span><span className={`v health-text health-text-${health}`}>{HEALTH_LABEL[health]}</span></div>
          <div className="kv-row"><span className="k">Target</span><span className="v">{loq.committedFinish ?? cinematic?.targetDate ?? '—'}</span></div>
          <div className="kv-row"><span className="k">Effort</span><span className="v">— / {loq.estimateDays ?? '—'} days (consumed/estimated)</span></div>
          <div className="kv-row"><span className="k">Versions</span><span className="v tbd-text">—</span></div>
          <div className="kv-row">
            <span className="k">Jira</span>
            <span className="v">
              {loq.jiraKey
                ? (jiraConfig?.baseUrl
                    ? <>{loq.jiraKey} · <a className="jira-link" href={jiraBrowseUrl(jiraConfig.baseUrl, loq.jiraKey)} target="_blank" rel="noreferrer">Open in Jira →</a></>
                    : loq.jiraKey)
                : <span className="tbd-text">—</span>}
            </span>
          </div>
        </div>
        <button type="button" className="loq-history-toggle" onClick={() => setHistoryOpen((v) => !v)}>
          View history {historyOpen ? '↑' : '↓'}
        </button>
        {historyOpen && (
          <div className="loq-history">
            <h3>Commitment history</h3>
            {commitmentHistory.length === 0 ? <p className="empty-inline">No commitment events.</p> : (
              <ul className="loq-history-list">
                {commitmentHistory.map((e) => (
                  <li key={e.id}>
                    <span className="loq-history-when">{e.changedAt.slice(0, 10)}</span>
                    <span className="loq-history-what">{e.committedStart ?? '…'} → {e.committedFinish ?? '…'}</span>
                    <span className="loq-history-who">{e.reason}{e.comment ? ` — ${e.comment}` : ''} ({e.changedBy})</span>
                  </li>
                ))}
              </ul>
            )}
            <h3>Variance history</h3>
            {varianceHistory.length === 0 ? <p className="empty-inline">No declared variances.</p> : (
              <ul className="loq-history-list">
                {varianceHistory.map((e) => (
                  <li key={e.id}>
                    <span className="loq-history-when">{e.declaredAt.slice(0, 10)}</span>
                    <span className="loq-history-what">{e.category} ({e.deltaDays >= 0 ? '+' : ''}{e.deltaDays}d)</span>
                    <span className="loq-history-who">{e.comment} ({e.declaredBy})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="card panel">
        <div className="panel-header">
          <h2>Edit</h2>
          <div className="panel-header-toggles">
            <Button variant="secondary" size="sm" onClick={() => setVarianceOpen(true)}>Declare variance</Button>
            <ConfirmButton label="Delete" onConfirm={() => { deleteLoq(loq.id); backToCinematic(); }} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="loqd-discipline">Discipline</label>
            <select id="loqd-discipline" value={draft.disciplineId} onChange={(e) => setField('disciplineId', e.target.value)}>
              {disciplines.length === 0 && <option value="">No disciplines yet</option>}
              {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="loqd-type">Type</label>
            <input id="loqd-type" value={draft.type} onChange={(e) => setField('type', e.target.value)} placeholder="L1, L2, Final…" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="loqd-status">Status</label>
            {effectiveStatus != null ? (
              <div className="loq-status-piloted">
                {effectiveStatus === UNMAPPED ? (
                  <>
                    <span className="loq-status loq-status-unmapped">À mapper</span>
                    <p className="field-hint">This Jira status isn’t mapped yet — add it in Settings → Status mapping.</p>
                  </>
                ) : (
                  <>
                    <span className={`loq-status loq-status-${effectiveStatus.toLowerCase()}`}>{CANONICAL_STATUS_LABEL[effectiveStatus]}</span>
                    <p className="field-hint">Piloté par Jira — mirrored from the bound issue’s status.</p>
                  </>
                )}
              </div>
            ) : (
              <select id="loqd-status" value={draft.status} onChange={(e) => setField('status', e.target.value as LoqStatus)}>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            )}
          </div>
          <div className="field">
            <label htmlFor="loqd-estimate">Estimate (days)</label>
            <input
              id="loqd-estimate"
              type="number"
              min={0}
              step={0.5}
              value={draft.estimateDays ?? ''}
              onChange={(e) => setField('estimateDays', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field loq-committed-readout">
          <label>Committed window</label>
          <div className="loq-committed-readout-row">
            <span>{loq.committedStart ? `${loq.committedStart} → ${loq.committedFinish ?? '…'}` : 'Unscheduled'}</span>
            <Button variant="secondary" size="sm" onClick={() => setRecommitOpen(true)}>Re-commit dates…</Button>
          </div>
          <p className="field-hint">Committed dates change only via an attributed, justified re-commit — never edited directly here.</p>
        </div>

        <div className="field">
          <label htmlFor="loqd-jira">Jira key</label>
          <input id="loqd-jira" value={draft.jiraKey ?? ''} onChange={(e) => setField('jiraKey', e.target.value || null)} placeholder="PROD-1234" />
        </div>

        <div className="field">
          <label htmlFor="loqd-dod">Definition of done</label>
          <textarea id="loqd-dod" rows={3} value={draft.dodRef} onChange={(e) => setField('dodRef', e.target.value)} placeholder="Reference or checklist…" />
        </div>

        <div className="field field-checkbox">
          <label htmlFor="loqd-paused">
            <input id="loqd-paused" type="checkbox" checked={draft.paused} onChange={(e) => setField('paused', e.target.checked)} />
            Paused
          </label>
        </div>

        <div className="loq-edit-footer">
          <Button variant="primary" disabled={!canSave || !dirty} onClick={save}>Save changes</Button>
        </div>
      </div>

      <div className="card panel">
        <div className="panel-header"><h2>Dependencies editor</h2></div>
        <LoqDependencyEditor loqs={cinematicLoqs} disciplines={disciplines} />
      </div>

      {recommitOpen && (
        <RecommitDialog
          loq={loq}
          initialStart={loq.committedStart}
          initialFinish={loq.committedFinish}
          onClose={() => setRecommitOpen(false)}
        />
      )}
      {varianceOpen && <VarianceDialog loq={loq} onClose={() => setVarianceOpen(false)} />}
    </div>
  );
}
