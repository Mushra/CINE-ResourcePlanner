import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { getSanityChecks, type SanityCheck } from '../../engine/validation';
import {
  HEALTH_LABEL, buildEffectiveStatusMap, deriveLoqHealth, projectAttention,
  representativeLoq, statusResolverFrom, worstDiscipline,
  type AttentionItem, type WatchtowerHealth,
} from '../../engine/watchtower';
import {
  BUG_BUCKETS, BUG_BUCKET_LABEL, CANONICAL_STATUS_LABEL, UNMAPPED,
  bugStatusBucket, type BugStatusBucket, type EffectiveStatus,
} from '../../domain/jiraStatusMap';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { MissingLoqs } from '../components/MissingLoqs';
import { suggestDisciplineForRows } from '../../domain/loqDiscovery';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmptyState } from '../components/EmptyState';
import { CinematicFormDrawer, type CinematicFormValue } from '../components/CinematicFormDrawer';
import { LoqTimeline } from '../components/LoqTimeline';
import { RecommitDialog } from '../components/RecommitDialog';
import { VarianceDialog } from '../components/VarianceDialog';
import type { CinematicRelatedIssue, Loq } from '../../domain/types';
import type { MissingLoqInfo } from '../../store/useStore';

const SEVERITY_RANK: Record<SanityCheck['severity'], number> = { critical: 2, warning: 1, info: 0 };

/** Stable empty fallback so the discoveredMissingLoqs selector never returns a fresh array. */
const EMPTY_MISSING_LOQS: MissingLoqInfo[] = [];

/** Status cell for a LOQ row, honouring its effective (Jira-mirrored) status. A voluntary pause
 * reads "On hold"; a bound row whose Jira status isn't mapped reads "À mapper" (never a silent
 * default); everything else shows the canonical label. */
function loqStatusCell(loq: Loq, effective: EffectiveStatus | undefined): { className: string; label: string } {
  if (loq.paused) return { className: 'loq-status-on-hold', label: 'On hold' };
  const eff = effective ?? loq.status;
  if (eff === UNMAPPED) return { className: 'loq-status-unmapped', label: 'À mapper' };
  return { className: `loq-status-${eff.toLowerCase()}`, label: CANONICAL_STATUS_LABEL[eff] };
}

const VERSION_PLAYER_GAP = "Needs a ShotGrid/Flow connector to fetch and stream published review versions, and to expose the publish/push event log.";

const JIRA_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/;

/** Deep-link to a single issue's page. */
function jiraBrowseUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/browse/${key}`;
}
/** Link to the Jira issue navigator pre-filtered by a JQL query. */
function jiraSearchUrl(baseUrl: string, jql: string): string {
  return `${baseUrl.replace(/\/$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

/** Hotlines widget: only the currently-open hotlines are listed (a status dot, the Jira key, its
 * summary and assignee). Resolved ones aren't listed — they're summarised in a small report line. */
function HotlineList({ issues, baseUrl }: { issues: CinematicRelatedIssue[]; baseUrl: string | null }) {
  return (
    <ul className="hotline-list">
      {issues.map((issue) => (
        <li key={issue.jiraKey} className="hotline-row">
          <span className="hotline-dot" />
          {baseUrl ? (
            <a className="hotline-key" href={jiraBrowseUrl(baseUrl, issue.jiraKey)} target="_blank" rel="noreferrer">{issue.jiraKey}</a>
          ) : (
            <span className="hotline-key">{issue.jiraKey}</span>
          )}
          <span className="hotline-title">{issue.summary ?? '—'}</span>
          {issue.assignee && <span className="hotline-assignee">{issue.assignee}</span>}
        </li>
      ))}
    </ul>
  );
}

/** QA-bugs widget: metrics only — one tile per status bucket. Each tile with issues links to the
 * Jira issue navigator filtered to exactly that bucket's bugs for this cinematic (`key in (…)`), so
 * "Open"/"In Progress"/… open the matching bugs in the browser. */
function BugMetrics({ bugsByBucket, baseUrl }: { bugsByBucket: Record<BugStatusBucket, CinematicRelatedIssue[]>; baseUrl: string | null }) {
  return (
    <div className="bug-metrics">
      {BUG_BUCKETS.map((bucket) => {
        const issues = bugsByBucket[bucket];
        const keys = issues.map((b) => b.jiraKey).filter((k) => JIRA_KEY_RE.test(k));
        const href = baseUrl && keys.length > 0 ? jiraSearchUrl(baseUrl, `key in (${keys.join(', ')})`) : null;
        const inner = (
          <>
            <div className="bug-metric-value">{issues.length}</div>
            <div className="bug-metric-label">{BUG_BUCKET_LABEL[bucket]}</div>
          </>
        );
        return href ? (
          <a key={bucket} className="bug-metric bug-metric-link" href={href} target="_blank" rel="noreferrer">{inner}</a>
        ) : (
          <div key={bucket} className="bug-metric">{inner}</div>
        );
      })}
    </div>
  );
}

export function CinematicDetail({ cinematicId }: { cinematicId: string }) {
  const cinematic = useStore((s) => s.data.cinematics.find((c) => c.id === cinematicId));
  const project = useStore((s) => s.data.projects.find((p) => p.id === cinematic?.projectId));
  const engine = useStore((s) => s.engine);
  const jiraConfigs = useStore((s) => s.jiraConfigs);
  const disciplines = useStore((s) => s.data.disciplines);
  const people = useStore((s) => s.data.people);
  const pools = useStore((s) => s.data.pools);
  const loqs = useStore((s) => s.data.loqs);
  const updateCinematic = useStore((s) => s.updateCinematic);
  const deleteCinematic = useStore((s) => s.deleteCinematic);
  const createLoq = useStore((s) => s.createLoq);
  const deleteLoq = useStore((s) => s.deleteLoq);
  const relatedIssues = useStore((s) => s.data.cinematicRelatedIssues);
  const refreshCinematicView = useStore((s) => s.refreshCinematicView);
  const applyDependencyFlow = useStore((s) => s.applyDependencyFlow);
  const addDiscoveredLoqs = useStore((s) => s.addDiscoveredLoqs);
  const bindDiscoveredDepartment = useStore((s) => s.bindDiscoveredDepartment);
  // Select the stored entry (a stable reference, or undefined) — never a fresh [] inside the
  // selector, which would loop Zustand's reference-equality re-render check.
  const missingLoqs = useStore((s) => s.discoveredMissingLoqs[cinematicId]) ?? EMPTY_MISSING_LOQS;
  const backToProject = useUiStore((s) => s.backToProject);
  const openLoq = useUiStore((s) => s.openLoq);
  const [editing, setEditing] = useState(false);
  const [recommitTarget, setRecommitTarget] = useState<{ loq: Loq; initialStart: string | null; initialFinish: string | null } | null>(null);
  const [varianceTarget, setVarianceTarget] = useState<Loq | null>(null);
  const [focus, setFocus] = useState<string>('ALL');

  /** Create a blank LOQ (defaults mirror the old New-LOQ drawer) and open its page to fill in. */
  function handleNewLoq(): void {
    const created = createLoq({
      cinematicId: cinematic!.id,
      disciplineId: disciplines[0]?.id ?? '',
      jiraKey: null,
      type: '',
      status: 'TODO',
      estimateDays: null,
      committedStart: null,
      committedFinish: null,
      actualFinish: null,
      dodRef: '',
      paused: false,
    });
    openLoq(created.id, cinematic!.id);
  }

  // Live-refresh this cinematic on open — the Jira-mirrored status of the bound epic and its LOQs,
  // plus the Hotline/QA-bug widgets (with discovery of newly-tagged ones) — so the page is current
  // without a full project sync. Toasts only when something changed; guarded/silent in a browser tab.
  useEffect(() => {
    applyDependencyFlow(cinematicId); // re-materialize the dependency flow (pure-DB, no-op when current)
    void refreshCinematicView(cinematicId);
  }, [cinematicId, applyDependencyFlow, refreshCinematicView]);

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
  const effectiveStatusMap = buildEffectiveStatusMap(engine, jiraConfigs);
  const statusOf = statusResolverFrom(effectiveStatusMap);
  const jiraConfig = project ? jiraConfigs.find((c) => c.projectId === project.id) ?? null : null;

  const checks = project ? getSanityChecks(engine, jiraConfigs).filter((c) => c.projectId === project.id) : [];
  const cinematicAttention: AttentionItem[] = project
    ? projectAttention(engine, checks, project.id)
      .filter((item) => item.cinematicId === cinematic.id && item.source !== 'Production Planning')
      .filter((item) => focus === 'ALL' || item.check.disciplineId === focus)
      .sort((a, b) => SEVERITY_RANK[b.check.severity] - SEVERITY_RANK[a.check.severity])
    : [];

  const focusDisciplineId = focus !== 'ALL' ? focus : worstDiscipline(cinematic.id, disciplineIds, loqs, forecasts, statusOf);
  const focusDisciplineName = focusDisciplineId ? disciplines.find((d) => d.id === focusDisciplineId)?.name ?? focusDisciplineId : null;
  const focusLoq = focusDisciplineId ? representativeLoq(loqs, cinematic.id, focusDisciplineId, statusOf) : null;
  const focusHealth: WatchtowerHealth | null = focusLoq ? deriveLoqHealth(focusLoq, forecasts.get(focusLoq.id), statusOf(focusLoq)) : null;
  const focusForecastFinish = focusLoq ? forecasts.get(focusLoq.id)?.forecastFinish ?? focusLoq.actualFinish ?? null : null;

  // Split the related issues by kind, then reduce each to what its widget shows. Resolved/open both
  // key off bugStatusBucket so the two widgets agree on what "resolved" means (a resolution date, or
  // a status that maps to Done/Cut).
  const statusMapping = jiraConfig?.statusMapping ?? null;
  const cinematicRelated = relatedIssues.filter((r) => r.cinematicId === cinematic.id);
  const hotlines = cinematicRelated.filter((r) => r.kind === 'hotline');
  const bugs = cinematicRelated.filter((r) => r.kind === 'bug');

  // Hotlines: list only the currently-open ones (freshest first); the rest fold into a resolved count.
  const openHotlines = hotlines
    .filter((h) => bugStatusBucket(h.status, h.resolutionDate, statusMapping) !== 'resolved')
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const resolvedHotlineCount = hotlines.length - openHotlines.length;

  // QA bugs: grouped per status bucket so each tile can both count and deep-link to its bugs.
  const bugsByBucket: Record<BugStatusBucket, CinematicRelatedIssue[]> = { open: [], inProgress: [], waitingFor: [], resolved: [] };
  for (const bug of bugs) bugsByBucket[bugStatusBucket(bug.status, bug.resolutionDate, statusMapping)].push(bug);

  // Bind an unresolved discovery department onto an existing discipline (remembered globally), then
  // re-run discovery so its rows resolve and become addable.
  async function handleBindDepartment(detectedKey: string, disciplineId: string): Promise<void> {
    bindDiscoveredDepartment(detectedKey, disciplineId);
    await refreshCinematicView(cinematicId);
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
                      onClick={() => linkedLoq && openLoq(linkedLoq.id, cinematic.id)}
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
              <div className="kv-row"><span className="k">Status</span><span className="v">{loqStatusCell(focusLoq, effectiveStatusMap.get(focusLoq.id)).label}</span></div>
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

      <div className="cd-grid2">
        <div className="card panel">
          <div className="panel-header">
            <h2>Hotlines</h2>
            {hotlines.length > 0 && <span className="panel-sub">{openHotlines.length} open</span>}
          </div>
          {hotlines.length > 0 ? (
            <>
              {openHotlines.length > 0 ? (
                <HotlineList issues={openHotlines} baseUrl={jiraConfig?.baseUrl ?? null} />
              ) : (
                <p className="empty-inline">No open hotlines.</p>
              )}
              {resolvedHotlineCount > 0 && <p className="hotline-report">{resolvedHotlineCount} resolved</p>}
            </>
          ) : (
            <EmptyState icon="check" title="No hotlines" description={`No ${jiraConfig?.hotlineLabel ?? 'CINE_HOTLINE'} issues linked to this cinematic.`} compact />
          )}
        </div>

        <div className="card panel">
          <div className="panel-header">
            <h2>QA bugs</h2>
            {bugs.length > 0 && <span className="panel-sub">{bugsByBucket.open.length} open · {bugs.length} total</span>}
          </div>
          {bugs.length > 0 ? (
            <BugMetrics bugsByBucket={bugsByBucket} baseUrl={jiraConfig?.baseUrl ?? null} />
          ) : (
            <EmptyState icon="check" title="No bugs" description="No Jira bugs linked to this cinematic." compact />
          )}
        </div>
      </div>

      <div className="card loqs-card">
        <div className="panel-header">
          <h2>LOQs</h2>
          <span className="panel-sub">Day-level milestones for this cinematic</span>
          <div className="panel-header-toggles">
            <Button variant="primary" size="sm" icon="plus" onClick={handleNewLoq}>New LOQ</Button>
          </div>
        </div>

        <MissingLoqs
          rows={missingLoqs}
          disciplines={disciplines}
          jiraBaseUrl={jiraConfig?.baseUrl ?? null}
          cinematicId={cinematicId}
          onBind={(key, id) => void handleBindDepartment(key, id)}
          suggestDisciplineId={(groupRows) => suggestDisciplineForRows(groupRows, people, pools)}
          onAdd={(sels) => addDiscoveredLoqs(cinematicId, sels.map(({ jiraKey, disciplineId, type }) => ({ jiraKey, disciplineId, type })))}
        />

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
                  const statusCell = loqStatusCell(loq, effectiveStatusMap.get(loq.id));
                  return (
                    <tr key={loq.id} className="loq-row-clickable" onClick={() => openLoq(loq.id, cinematic.id)}>
                      <td>{discipline?.name ?? 'Unassigned'}</td>
                      <td className="cell-name">{loq.type}</td>
                      <td><span className={`loq-status ${statusCell.className}`}>{statusCell.label}</span></td>
                      <td>{loq.estimateDays ?? <span className="tbd-text">—</span>}</td>
                      <td>
                        {loq.committedStart
                          ? `${loq.committedStart} → ${loq.committedFinish ?? '…'}`
                          : <span className="tbd-text">Unscheduled</span>}
                      </td>
                      <td>
                        {loq.jiraKey
                          ? (jiraConfig?.baseUrl
                              ? <a className="jira-link" href={jiraBrowseUrl(jiraConfig.baseUrl, loq.jiraKey)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{loq.jiraKey}</a>
                              : loq.jiraKey)
                          : <span className="tbd-text">—</span>}
                      </td>
                      <td className="cell-actions" onClick={(e) => e.stopPropagation()}>
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
            key={cinematic.id}
            cinematicId={cinematic.id}
            onEditLoq={(loq) => openLoq(loq.id, cinematic.id)}
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
