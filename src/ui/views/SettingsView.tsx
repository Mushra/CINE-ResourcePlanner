import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Button } from '../components/Button';
import { Collapsible } from '../components/Collapsible';
import type { JiraProjectConfig } from '../../domain/types';
import { DEFAULT_JIRA_STATUS_MAPPING } from '../../domain/jiraStatusMap';
import { DEFAULT_HOTLINE_LABEL } from '../../domain/relatedIssues';
import { JiraStatusMappingEditor } from '../components/JiraStatusMappingEditor';
import { DependencyFlowEditor } from '../components/DependencyFlowEditor';
import { disciplineKey, resolveDiscoveryKeywords } from '../../domain/loqDiscovery';

const DEFAULT_CINEMATICS_LIST_FIELD = 'customfield_10420';
const DEFAULT_LOQ_TARGET_FIELD = 'customfield_12338';
const DEFAULT_DUE_DATE_FIELD = 'duedate';
const DEFAULT_TOLERANCE_DAYS = 1;
/** Bracket-free scope so new configs don't emit `cf[id]` (rejected by some proxies) — see
 * JiraProjectConfig.scopeJql. References the Cinematics List field by its display name, and also
 * pulls Hotlines (label) and QA bugs (issuetype) so the Cinematic detail widgets have data. */
const DEFAULT_SCOPE_JQL = `("Cinematics List" is not EMPTY OR labels = ${DEFAULT_HOTLINE_LABEL} OR issuetype = Bug)`;

function emptyConfig(projectId: string): JiraProjectConfig {
  return {
    projectId,
    baseUrl: '',
    jiraProjectKey: '',
    authMode: 'server',
    email: null,
    startDateField: null,
    dueDateField: DEFAULT_DUE_DATE_FIELD,
    dateToleranceDays: DEFAULT_TOLERANCE_DAYS,
    cinematicsListField: DEFAULT_CINEMATICS_LIST_FIELD,
    loqTargetField: DEFAULT_LOQ_TARGET_FIELD,
    epicLinkField: null,
    scopeField: null,
    scopeValue: null,
    scopeJql: DEFAULT_SCOPE_JQL,
    statusMapping: { ...DEFAULT_JIRA_STATUS_MAPPING },
    hotlineLabel: DEFAULT_HOTLINE_LABEL,
    discoveryKeywords: null,
  };
}

type TestResult = { ok: true; total: number } | { ok: false; error: string };

export function SettingsView() {
  const projects = useStore((s) => s.data.projects);
  const getJiraConfigForProject = useStore((s) => s.getJiraConfigForProject);
  const setJiraConfigForProject = useStore((s) => s.setJiraConfigForProject);
  const jiraHasToken = useStore((s) => s.jiraHasToken);
  const jiraSetToken = useStore((s) => s.jiraSetToken);
  const jiraClearToken = useStore((s) => s.jiraClearToken);
  const testJiraConnection = useStore((s) => s.testJiraConnection);
  const disciplines = useStore((s) => s.data.disciplines);
  const discoveryKeywordsGlobal = useStore((s) => s.discoveryKeywordsGlobal);
  const setDiscoveryKeywordsGlobal = useStore((s) => s.setDiscoveryKeywordsGlobal);

  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const [projectId, setProjectId] = useState<string>('');
  const [value, setValue] = useState<JiraProjectConfig>(() => emptyConfig(''));
  const [pat, setPat] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  // Global LOQ-discovery keywords editor: one CSV draft per plan discipline, keyed by discipline id.
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [keywordsSaved, setKeywordsSaved] = useState(false);

  useEffect(() => {
    if (!projectId && sortedProjects.length > 0) setProjectId(sortedProjects[0].id);
  }, [projectId, sortedProjects]);

  // Seed the keyword drafts from the effective global map (saved global override, else built-in
  // defaults), one row per discipline, so the editor always shows what discovery currently uses.
  useEffect(() => {
    const effective = resolveDiscoveryKeywords(null, discoveryKeywordsGlobal);
    const drafts: Record<string, string> = {};
    for (const d of disciplines) drafts[d.id] = (effective[disciplineKey(d.name)] ?? []).join(', ');
    setKeywordDrafts(drafts);
  }, [disciplines, discoveryKeywordsGlobal]);

  useEffect(() => {
    if (!projectId) return;
    setValue(getJiraConfigForProject(projectId) ?? emptyConfig(projectId));
    setPat('');
    setTestResult(null);
    void jiraHasToken(projectId).then(setHasToken);
  }, [projectId, getJiraConfigForProject, jiraHasToken]);

  function set<K extends keyof JiraProjectConfig>(key: K, v: JiraProjectConfig[K]): void {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  async function handleSave(): Promise<void> {
    setJiraConfigForProject(value);
    if (pat.trim()) {
      const ok = await jiraSetToken(projectId, pat.trim());
      if (ok) {
        setPat('');
        setHasToken(true);
      }
    }
  }

  async function handleClearToken(): Promise<void> {
    await jiraClearToken(projectId);
    setHasToken(false);
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    const result = await testJiraConnection(projectId);
    setTesting(false);
    setTestResult(result);
  }

  function handleSaveKeywords(): void {
    // Build a disciplineKey→keywords map from the drafts, dropping empties. Whole-map replacement:
    // null (all empty) resets discovery to its built-in defaults.
    const map: Record<string, string[]> = {};
    for (const d of disciplines) {
      const words = (keywordDrafts[d.id] ?? '')
        .split(',')
        .map((w) => w.trim())
        .filter((w) => w.length > 0);
      if (words.length > 0) map[disciplineKey(d.name)] = words;
    }
    setDiscoveryKeywordsGlobal(Object.keys(map).length > 0 ? map : null);
    setKeywordsSaved(true);
  }

  const selectedProject = sortedProjects.find((p) => p.id === projectId);

  return (
    <div className="settings-view">
      <div className="view-header">
        <div>
          <h1>Settings</h1>
          <p className="view-sub">Jira connection settings, per project. The API token is stored only on this machine, never in the plan file.</p>
        </div>
      </div>

      <div className="field" style={{ maxWidth: 360, marginBottom: 16 }}>
        <label htmlFor="settings-project">Project</label>
        <select id="settings-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {sortedProjects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {selectedProject && (
        <div className="card settings-card">
          <div className="panel-header">
            <h2>Jira connection</h2>
            <span className="panel-sub">{selectedProject.name}</span>
          </div>

          <div className="field">
            <label htmlFor="jira-base-url">Base URL</label>
            <input
              id="jira-base-url"
              value={value.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
              placeholder="https://your-instance.atlassian.net"
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="jira-project-key">Jira project key</label>
              <input id="jira-project-key" value={value.jiraProjectKey} onChange={(e) => set('jiraProjectKey', e.target.value)} placeholder="OVR" />
            </div>
            <div className="field">
              <label htmlFor="jira-tolerance">Date tolerance (days)</label>
              <input
                id="jira-tolerance"
                type="number"
                min={0}
                value={value.dateToleranceDays}
                onChange={(e) => set('dateToleranceDays', Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>

          <div className="field">
            <label>Authentication</label>
            <div className="field-row" style={{ gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                <input type="radio" name="jira-auth-mode" checked={value.authMode === 'server'} onChange={() => set('authMode', 'server')} />
                Server / Data Center (Bearer token)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                <input type="radio" name="jira-auth-mode" checked={value.authMode === 'cloud'} onChange={() => set('authMode', 'cloud')} />
                Cloud (email + API token)
              </label>
            </div>
          </div>

          {value.authMode === 'cloud' && (
            <div className="field">
              <label htmlFor="jira-email">Email</label>
              <input id="jira-email" type="email" value={value.email ?? ''} onChange={(e) => set('email', e.target.value || null)} placeholder="you@studio.com" />
            </div>
          )}

          <div className="field">
            <label htmlFor="jira-pat">{value.authMode === 'cloud' ? 'API token' : 'Personal access token'}</label>
            <input
              id="jira-pat"
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder={hasToken ? 'Token is set — leave blank to keep it' : 'Not set'}
              autoComplete="off"
            />
            <p className="field-hint">
              {hasToken ? 'A token is stored on this machine.' : 'No token stored yet.'} Saved tokens are encrypted and never displayed again.
              {hasToken && (
                <>
                  {' '}
                  <button type="button" className="field-hint-reset" onClick={() => void handleClearToken()}>Clear token</button>
                </>
              )}
            </p>
          </div>

          <div className="field">
            <label htmlFor="jira-scope-jql">JQL scope (optional)</label>
            <input
              id="jira-scope-jql"
              value={value.scopeJql ?? ''}
              onChange={(e) => set('scopeJql', e.target.value || null)}
              placeholder={DEFAULT_SCOPE_JQL}
            />
            <p className="field-hint">
              AND-ed onto <code>project = {value.jiraProjectKey || 'KEY'}</code> to scope the fetch to bindable issues. Reference custom
              fields by their quoted display name (e.g. <code>"Cinematics List" is not EMPTY</code>) rather than <code>cf[id]</code> —
              some proxies reject the brackets with a 400. Leave blank to fetch the whole project.
            </p>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="jira-scope-field">Scope field (optional)</label>
              <input id="jira-scope-field" value={value.scopeField ?? ''} onChange={(e) => set('scopeField', e.target.value || null)} placeholder="customfield_XXXXX" />
            </div>
            <div className="field">
              <label htmlFor="jira-scope-value">Scope value</label>
              <input id="jira-scope-value" value={value.scopeValue ?? ''} onChange={(e) => set('scopeValue', e.target.value || null)} placeholder="e.g. Cinematics" />
            </div>
          </div>
          <p className="field-hint">Field/value scope used only when JQL scope above is blank (built in <code>cf[id]</code> form).</p>

          <Collapsible scopeKey="settings.jira.advanced" summary="Advanced — field mapping" defaultOpen={false} className="settings-advanced">
            <div className="field-row">
              <div className="field">
                <label htmlFor="jira-cinematics-field">Cinematics List field</label>
                <input id="jira-cinematics-field" value={value.cinematicsListField ?? ''} onChange={(e) => set('cinematicsListField', e.target.value || null)} placeholder={DEFAULT_CINEMATICS_LIST_FIELD} />
              </div>
              <div className="field">
                <label htmlFor="jira-loq-target-field">LOQ target field</label>
                <input id="jira-loq-target-field" value={value.loqTargetField ?? ''} onChange={(e) => set('loqTargetField', e.target.value || null)} placeholder={DEFAULT_LOQ_TARGET_FIELD} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="jira-start-date-field">Start date field</label>
                <input id="jira-start-date-field" value={value.startDateField ?? ''} onChange={(e) => set('startDateField', e.target.value || null)} placeholder="customfield_XXXXX" />
              </div>
              <div className="field">
                <label htmlFor="jira-due-date-field">Due date field</label>
                <input id="jira-due-date-field" value={value.dueDateField ?? ''} onChange={(e) => set('dueDateField', e.target.value || null)} placeholder={DEFAULT_DUE_DATE_FIELD} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="jira-epic-link-field">Epic Link field</label>
              <input id="jira-epic-link-field" value={value.epicLinkField ?? ''} onChange={(e) => set('epicLinkField', e.target.value || null)} placeholder="customfield_XXXXX" />
            </div>
          </Collapsible>

          <Collapsible scopeKey="settings.jira.statusMapping" summary="Status mapping — Jira → planner" defaultOpen={false} className="settings-advanced">
            <p className="field-hint">
              Maps each raw Jira status onto the planner's own vocabulary so a bound LOQ mirrors Jira in one language.
              A Jira status not listed here shows as <strong>À mapper</strong> until you add it. Matching is case-insensitive.
            </p>
            <JiraStatusMappingEditor
              value={value.statusMapping ?? {}}
              onChange={(next) => set('statusMapping', next)}
            />
          </Collapsible>

          {testResult && (
            testResult.ok ? (
              <p className="field-hint" style={{ color: 'var(--status-success, #2e7d32)' }}>
                Connected — {testResult.total} issue{testResult.total === 1 ? '' : 's'} matched.
              </p>
            ) : (
              <p className="field-hint field-hint-warning">{testResult.error}</p>
            )
          )}

          <div className="detail-header-actions" style={{ marginTop: 12 }}>
            <Button variant="secondary" disabled={testing || !value.baseUrl || !value.jiraProjectKey} onClick={() => void handleTest()}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            <Button variant="primary" icon="save" onClick={() => void handleSave()}>Save</Button>
          </div>
        </div>
      )}

      {sortedProjects.length === 0 && <p className="field-hint">Create a project first to configure its Jira connection.</p>}

      <div className="card settings-card">
        <div className="panel-header">
          <h2>LOQ discovery keywords</h2>
          <span className="panel-sub">Global — shared across projects</span>
        </div>
        <p className="field-hint">
          When you open a bound cinematic, the planner scans the Jira issues linked to it and proposes the ones whose summary names a
          tracked department. These keywords decide which departments count and how they're spelled in Jira. One discipline per row,
          comma-separated keywords; leave a row blank to skip that discipline. A single-word keyword must appear as a whole word in the
          summary (so <code>Anim</code> won't match <code>TechAnim</code>); a multi-word keyword matches even when the words are jammed
          together (<code>cin design</code> matches <code>CinDesign</code>). Clear every row to fall back to the built-in defaults.
        </p>
        {disciplines.length === 0 ? (
          <p className="field-hint">Create disciplines first — discovery maps keywords onto your plan's disciplines.</p>
        ) : (
          <>
            {[...disciplines].sort((a, b) => a.name.localeCompare(b.name)).map((d) => (
              <div className="field" key={d.id}>
                <label htmlFor={`kw-${d.id}`}>{d.name}</label>
                <input
                  id={`kw-${d.id}`}
                  value={keywordDrafts[d.id] ?? ''}
                  onChange={(e) => { setKeywordDrafts((prev) => ({ ...prev, [d.id]: e.target.value })); setKeywordsSaved(false); }}
                  placeholder="e.g. anim, animation"
                />
              </div>
            ))}
            <div className="detail-header-actions" style={{ marginTop: 12 }}>
              {keywordsSaved && <span className="field-hint" style={{ color: 'var(--status-success, #2e7d32)' }}>Saved.</span>}
              <Button variant="primary" icon="save" onClick={handleSaveKeywords}>Save keywords</Button>
            </div>
          </>
        )}
      </div>

      <div className="card settings-card">
        <div className="panel-header">
          <h2>Dependency flow</h2>
          <span className="panel-sub">Global — shared across projects</span>
        </div>
        <p className="field-hint">
          Models the "classic" dependency chains between LOQs — a prerequisite (discipline + level) that must finish before a dependent
          LOQ can start, e.g. <code>CIN Design L0 → Tech Anim L0 → Anim L0</code>. The flow is materialized per cinematic as read-only
          <strong> template</strong> edges whenever LOQs are created or discovered and when you open a cinematic; manual, MS&nbsp;Project
          and Jira edges always win and are never overwritten. Edit a row, then <strong>Apply</strong> to push the change into every
          cinematic now (reopening a cinematic also re-materializes it). Levels are matched case-insensitively against each LOQ's type.
        </p>
        <DependencyFlowEditor />
      </div>
    </div>
  );
}
