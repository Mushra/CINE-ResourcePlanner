import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import type { Discipline, Loq, LoqStatus } from '../../domain/types';

const STATUS_OPTIONS: { value: LoqStatus; label: string }[] = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'DONE', label: 'Done' },
];

export interface LoqFormValue {
  disciplineId: string;
  jiraKey: string | null;
  type: string;
  status: LoqStatus;
  estimateDays: number | null;
  dodRef: string;
  paused: boolean;
}

function fromLoq(disciplines: Discipline[], loq?: Loq): LoqFormValue {
  if (!loq) {
    return {
      disciplineId: disciplines[0]?.id ?? '',
      jiraKey: null,
      type: '',
      status: 'TODO',
      estimateDays: null,
      dodRef: '',
      paused: false,
    };
  }
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

export function LoqFormDrawer({
  loq, disciplines, onClose, onSave, onRecommit,
}: {
  loq?: Loq;
  disciplines: Discipline[];
  onClose: () => void;
  onSave: (value: LoqFormValue) => void;
  /** Only relevant when editing an existing LOQ — committed dates are changed via a separate,
   * justified re-commit action (PLANNING_ENGINE.md §3), never through this generic form. */
  onRecommit?: () => void;
}) {
  const [value, setValue] = useState<LoqFormValue>(() => fromLoq(disciplines, loq));
  const [initialSnapshot] = useState(() => JSON.stringify(value));
  const canSave = value.disciplineId.trim().length > 0 && value.type.trim().length > 0;
  const dirty = JSON.stringify(value) !== initialSnapshot;

  function set<K extends keyof LoqFormValue>(key: K, v: LoqFormValue[K]): void {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <Drawer title={loq ? 'Edit LOQ' : 'New LOQ'} onClose={onClose} dirty={dirty}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="loq-discipline">Discipline</label>
          <select id="loq-discipline" value={value.disciplineId} onChange={(e) => set('disciplineId', e.target.value)}>
            {disciplines.length === 0 && <option value="">No disciplines yet</option>}
            {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="loq-type">Type</label>
          <input id="loq-type" value={value.type} onChange={(e) => set('type', e.target.value)} placeholder="L1, L2, Final…" />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="loq-status">Status</label>
          <select id="loq-status" value={value.status} onChange={(e) => set('status', e.target.value as LoqStatus)}>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="loq-estimate">Estimate (days)</label>
          <input
            id="loq-estimate"
            type="number"
            min={0}
            step={0.5}
            value={value.estimateDays ?? ''}
            onChange={(e) => set('estimateDays', e.target.value === '' ? null : Number(e.target.value))}
          />
        </div>
      </div>

      {loq && (
        <div className="field loq-committed-readout">
          <label>Committed window</label>
          <div className="loq-committed-readout-row">
            <span>
              {loq.committedStart
                ? `${loq.committedStart} → ${loq.committedFinish ?? '…'}`
                : 'Unscheduled'}
            </span>
            <Button variant="secondary" size="sm" onClick={onRecommit}>Re-commit dates…</Button>
          </div>
          <p className="field-hint">Committed dates change only via an attributed, justified re-commit — never edited directly here.</p>
        </div>
      )}

      <div className="field">
        <label htmlFor="loq-jira">Jira key</label>
        <input id="loq-jira" value={value.jiraKey ?? ''} onChange={(e) => set('jiraKey', e.target.value || null)} placeholder="PROD-1234" />
      </div>

      <div className="field">
        <label htmlFor="loq-dod">Definition of done</label>
        <textarea id="loq-dod" rows={3} value={value.dodRef} onChange={(e) => set('dodRef', e.target.value)} placeholder="Reference or checklist…" />
      </div>

      <div className="field field-checkbox">
        <label htmlFor="loq-paused">
          <input id="loq-paused" type="checkbox" checked={value.paused} onChange={(e) => set('paused', e.target.checked)} />
          Paused
        </label>
      </div>

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={() => onSave(value)}>
          {loq ? 'Save changes' : 'Create LOQ'}
        </Button>
      </div>
    </Drawer>
  );
}
