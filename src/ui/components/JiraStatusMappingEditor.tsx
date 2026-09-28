import { useState } from 'react';
import { Button } from './Button';
import { ConfirmButton } from './ConfirmButton';
import { CANONICAL_STATUSES, CANONICAL_STATUS_LABEL } from '../../domain/jiraStatusMap';
import type { LoqStatus } from '../../domain/types';

/**
 * Controlled editor for a project's raw-Jira-status → canonical-LoqStatus mapping. Fully controlled
 * (no store access): it edits the `statusMapping` slice of the config the parent SettingsView holds,
 * which is persisted on Save like every other field. Keys are the raw Jira status strings (matched
 * case-insensitively at resolve time — see resolveJiraStatus); targets are the 6 canonical statuses.
 * `paused` is deliberately not a target: it's the voluntary hold, never Jira-driven.
 */
export function JiraStatusMappingEditor({
  value,
  onChange,
}: {
  value: Record<string, LoqStatus>;
  onChange: (next: Record<string, LoqStatus>) => void;
}) {
  const [newRaw, setNewRaw] = useState('');
  const [newTarget, setNewTarget] = useState<LoqStatus>('TODO');

  const rows = Object.entries(value).sort((a, b) => a[0].localeCompare(b[0]));

  function setTarget(rawKey: string, target: LoqStatus): void {
    onChange({ ...value, [rawKey]: target });
  }

  function rename(oldKey: string, nextKey: string): void {
    const trimmed = nextKey.trim();
    if (!trimmed || trimmed === oldKey) return;
    const next: Record<string, LoqStatus> = {};
    for (const [k, v] of Object.entries(value)) next[k === oldKey ? trimmed : k] = v;
    onChange(next);
  }

  function remove(rawKey: string): void {
    const next = { ...value };
    delete next[rawKey];
    onChange(next);
  }

  function add(): void {
    const trimmed = newRaw.trim();
    if (!trimmed) return;
    onChange({ ...value, [trimmed]: newTarget });
    setNewRaw('');
    setNewTarget('TODO');
  }

  const duplicate = newRaw.trim().length > 0
    && Object.keys(value).some((k) => k.toLowerCase() === newRaw.trim().toLowerCase());

  return (
    <div className="status-mapping-editor">
      {rows.length === 0 ? (
        <p className="empty-inline">No status mappings yet — every bound Jira status will show as “À mapper”.</p>
      ) : (
        <ul className="status-mapping-list">
          {rows.map(([rawKey, target]) => (
            <li key={rawKey} className="status-mapping-row">
              <input
                className="status-mapping-raw"
                defaultValue={rawKey}
                onBlur={(e) => rename(rawKey, e.target.value)}
                aria-label={`Jira status mapped to ${CANONICAL_STATUS_LABEL[target]}`}
              />
              <span className="status-mapping-arrow" aria-hidden="true">→</span>
              <select
                className="status-mapping-target"
                value={target}
                onChange={(e) => setTarget(rawKey, e.target.value as LoqStatus)}
                aria-label={`Planner status for Jira "${rawKey}"`}
              >
                {CANONICAL_STATUSES.map((s) => <option key={s} value={s}>{CANONICAL_STATUS_LABEL[s]}</option>)}
              </select>
              <ConfirmButton label="Delete" onConfirm={() => remove(rawKey)} />
            </li>
          ))}
        </ul>
      )}

      <div className="status-mapping-add field-row">
        <div className="field">
          <label htmlFor="status-mapping-new-raw">Jira status</label>
          <input
            id="status-mapping-new-raw"
            value={newRaw}
            onChange={(e) => setNewRaw(e.target.value)}
            placeholder="e.g. Ready for QA"
          />
        </div>
        <div className="field">
          <label htmlFor="status-mapping-new-target">Planner status</label>
          <select id="status-mapping-new-target" value={newTarget} onChange={(e) => setNewTarget(e.target.value as LoqStatus)}>
            {CANONICAL_STATUSES.map((s) => <option key={s} value={s}>{CANONICAL_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <Button variant="primary" size="sm" icon="plus" disabled={!newRaw.trim() || duplicate} onClick={add}>
          Add mapping
        </Button>
      </div>
      {duplicate && <p className="field-hint field-hint-warning">That Jira status is already mapped.</p>}
    </div>
  );
}
