import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import { useStore } from '../../store/useStore';
import { suggestJiraBindings, type JiraBindingProposals, type BindingKind } from '../../domain/jiraBinding';
import type { ConfirmedJiraBindings, JiraApplyReport } from '../../db/applyJiraSync';
import type { NormalizedJiraBatch } from '../../import/jiraSync';
import type { Cinematic, Loq } from '../../domain/types';

function toConfirmed(proposals: JiraBindingProposals): ConfirmedJiraBindings {
  const cinematics: Record<string, string | null> = {};
  for (const p of proposals.cinematics) cinematics[p.cinematicId] = p.via === 'unmatched' ? null : p.proposedKey;
  const loqs: Record<string, string | null> = {};
  for (const p of proposals.loqs) loqs[p.loqId] = p.via === 'unmatched' ? null : p.proposedKey;
  return { cinematics, loqs };
}

function allExactMatched(proposals: JiraBindingProposals): boolean {
  return proposals.cinematics.every((p) => p.via === 'exact-key') && proposals.loqs.every((p) => p.via === 'exact-key');
}

/** Opens scoped to one project, same guarantee as MppImportDrawer: bindings are only ever written
 * into this project's own Cinematics/LOQs — see applyJiraSync.ts. Fed from a manually-exported
 * Jira search-response .json until Phase 5b's real HTTP client replaces the file picker; the
 * suggest/confirm/apply layers underneath stay the same either way. */
export function JiraBindingDrawer({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const allCinematics = useStore((s) => s.data.cinematics);
  const allLoqs = useStore((s) => s.data.loqs);
  const disciplines = useStore((s) => s.data.disciplines);
  const loadJiraExportFile = useStore((s) => s.loadJiraExportFile);
  const applyJiraBindingsToProject = useStore((s) => s.applyJiraBindingsToProject);

  const projectCinematics = allCinematics.filter((c) => c.projectId === projectId);
  const projectCinematicIds = new Set(projectCinematics.map((c) => c.id));
  const projectLoqs = allLoqs.filter((l) => projectCinematicIds.has(l.cinematicId));

  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [batch, setBatch] = useState<NormalizedJiraBatch | null>(null);
  const [proposals, setProposals] = useState<JiraBindingProposals | null>(null);
  const [choices, setChoices] = useState<ConfirmedJiraBindings>({ cinematics: {}, loqs: {} });
  const [report, setReport] = useState<JiraApplyReport | null>(null);

  async function pickFile(): Promise<void> {
    setBusy(true);
    const result = await loadJiraExportFile();
    setBusy(false);
    if (!result) return;

    const suggested = suggestJiraBindings(projectCinematics, projectLoqs, disciplines, result.batch);
    setFileName(result.fileName);
    setBatch(result.batch);
    setProposals(suggested);
    setChoices(toConfirmed(suggested));

    if (allExactMatched(suggested)) setReport(applyJiraBindingsToProject(projectId, result.batch, toConfirmed(suggested)));
  }

  function runApply(): void {
    if (!batch) return;
    setReport(applyJiraBindingsToProject(projectId, batch, choices));
  }

  return (
    <Drawer title={`Sync with Jira — ${projectName}`} onClose={onClose} width={520}>
      {report ? (
        <JiraApplyReportView fileName={fileName} report={report} onClose={onClose} />
      ) : proposals && batch ? (
        <BindingMappingStep
          fileName={fileName}
          cinematics={projectCinematics}
          loqs={projectLoqs}
          disciplines={disciplines}
          proposals={proposals}
          batch={batch}
          choices={choices}
          onChangeCinematic={(id, key) => setChoices((prev) => ({ ...prev, cinematics: { ...prev.cinematics, [id]: key } }))}
          onChangeLoq={(id, key) => setChoices((prev) => ({ ...prev, loqs: { ...prev.loqs, [id]: key } }))}
        >
          <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={runApply}>Apply bindings</Button>
          </div>
        </BindingMappingStep>
      ) : (
        <>
          <p className="drawer-hint">
            Import a Jira REST search-response export (.json) to propose bindings between{' '}
            <strong>{projectName}</strong>'s Cinematics/LOQs and Jira issues, confirm or override
            each one, then verify start/end dates match. Only this project is affected. Jira never
            silently overwrites the plan — mismatches surface as a "Jira inconsistency" check instead.
          </p>
          <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void pickFile()}>
              {busy ? 'Reading file…' : 'Choose Jira export…'}
            </Button>
          </div>
        </>
      )}
    </Drawer>
  );
}

function BindingMappingStep({
  fileName, cinematics, loqs, disciplines, proposals, batch, choices, onChangeCinematic, onChangeLoq, children,
}: {
  fileName: string | null;
  cinematics: Cinematic[];
  loqs: Loq[];
  disciplines: { id: string; name: string }[];
  proposals: JiraBindingProposals;
  batch: NormalizedJiraBatch;
  choices: ConfirmedJiraBindings;
  onChangeCinematic: (cinematicId: string, jiraKey: string | null) => void;
  onChangeLoq: (loqId: string, jiraKey: string | null) => void;
  children: React.ReactNode;
}) {
  const cinematicById = new Map(cinematics.map((c) => [c.id, c]));
  const loqById = new Map(loqs.map((l) => [l.id, l]));
  const disciplineNameById = new Map(disciplines.map((d) => [d.id, d.name]));

  return (
    <>
      <p className="drawer-hint">
        {fileName ? `${fileName} — ` : ''}review the proposed bindings below, override any of them, or
        pick "Don't link" to leave a row unbound.
      </p>
      <div className="jira-binding-section">
        <h3>Cinematics</h3>
        {proposals.cinematics.map((p) => {
          const cinematic = cinematicById.get(p.cinematicId);
          if (!cinematic) return null;
          return (
            <div key={p.cinematicId} className="jira-binding-row">
              <div className="jira-binding-name">{cinematic.name}</div>
              <BindingSelect
                batch={batch}
                via={p.via}
                score={p.score}
                value={choices.cinematics[p.cinematicId] ?? null}
                onChange={(key) => onChangeCinematic(p.cinematicId, key)}
              />
            </div>
          );
        })}
      </div>
      <div className="jira-binding-section">
        <h3>LOQs</h3>
        {proposals.loqs.map((p) => {
          const loq = loqById.get(p.loqId);
          if (!loq) return null;
          const cinematicName = cinematicById.get(loq.cinematicId)?.name ?? '';
          const disciplineName = disciplineNameById.get(loq.disciplineId) ?? 'Unassigned';
          return (
            <div key={p.loqId} className="jira-binding-row">
              <div className="jira-binding-name">{disciplineName} · {loq.type} ({cinematicName})</div>
              <BindingSelect
                batch={batch}
                via={p.via}
                score={p.score}
                value={choices.loqs[p.loqId] ?? null}
                onChange={(key) => onChangeLoq(p.loqId, key)}
              />
            </div>
          );
        })}
      </div>
      {children}
    </>
  );
}

/** Labels shown for every BindingKind except 'name' (which shows a live "match N%" instead, since
 * its whole point is the score) and 'unmatched' (its own badge below). */
const SIGNAL_LABEL: Record<Exclude<BindingKind, 'name' | 'unmatched'>, string> = {
  'exact-key': 'exact key',
  'cinematics-field': 'Cinematics List',
  'epic-link': 'Epic link',
};

function BindingSelect({
  batch, via, score, value, onChange,
}: {
  batch: NormalizedJiraBatch;
  via: BindingKind;
  score: number | null;
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  return (
    <div className="jira-binding-select">
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Don't link</option>
        {batch.issues.map((issue) => (
          <option key={issue.key} value={issue.key}>{issue.key} — {issue.summary}</option>
        ))}
      </select>
      {via === 'unmatched' ? (
        <span className="jira-binding-badge jira-binding-badge-unmatched">unmatched</span>
      ) : via === 'name' ? (
        <span className="jira-binding-badge">{score != null ? `match ${Math.round(score * 100)}%` : 'match'}</span>
      ) : (
        <span className={`jira-binding-badge${via === 'exact-key' ? ' jira-binding-badge-exact' : ''}`}>
          via {SIGNAL_LABEL[via]}
        </span>
      )}
    </div>
  );
}

function JiraApplyReportView({ fileName, report, onClose }: { fileName: string | null; report: JiraApplyReport; onClose: () => void }) {
  return (
    <>
      <p className="drawer-hint">Synced{fileName ? ` from ${fileName}` : ''}.</p>
      <ul className="import-summary">
        <li>{report.cinematicsLinked} cinematic{report.cinematicsLinked === 1 ? '' : 's'} linked</li>
        <li>{report.loqsLinked} LOQ{report.loqsLinked === 1 ? '' : 's'} linked</li>
      </ul>
      {(report.cinematicsSkippedOtherProject > 0 || report.loqsSkippedOtherProject > 0) && (
        <div className="import-note">
          Skipped {report.cinematicsSkippedOtherProject + report.loqsSkippedOtherProject} binding
          {report.cinematicsSkippedOtherProject + report.loqsSkippedOtherProject === 1 ? '' : 's'} already claimed elsewhere — left untouched.
        </div>
      )}
      {report.warnings.length > 0 && (
        <ul className="import-warnings">
          {report.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}
      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}
