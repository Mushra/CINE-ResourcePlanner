import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import type { Discipline, ResourcePool } from '../../domain/types';

export interface PoolFormValue {
  name: string;
  disciplineId: string | null;
  color: string;
}

const DEFAULT_COLOR = '#4f7cff';

function fromPool(pool?: ResourcePool, defaultDisciplineId?: string | null): PoolFormValue {
  if (!pool) return { name: '', disciplineId: defaultDisciplineId ?? null, color: DEFAULT_COLOR };
  return { name: pool.name, disciplineId: pool.disciplineId, color: pool.color };
}

export function PoolFormDrawer({
  pool, disciplines, defaultDisciplineId, otherPools, moveRule, onSetMoveRule, onClearMoveRule, onClose, onSave,
}: {
  pool?: ResourcePool;
  disciplines: Discipline[];
  defaultDisciplineId?: string | null;
  /** Other roles this role's people could be moved into en masse — only relevant when editing an existing role. */
  otherPools?: ResourcePool[];
  /** The active "move this whole role" rule sourced from this role, if any. */
  moveRule?: { targetPoolId: string | null; targetPoolName: string } | null;
  onSetMoveRule?: (targetPoolId: string) => void;
  onClearMoveRule?: () => void;
  onClose: () => void;
  onSave: (value: PoolFormValue) => void;
}) {
  const [value, setValue] = useState<PoolFormValue>(() => fromPool(pool, defaultDisciplineId));
  const [initialSnapshot] = useState(() => JSON.stringify(value));
  const canSave = value.name.trim().length > 0;
  const dirty = JSON.stringify(value) !== initialSnapshot;

  function set<K extends keyof PoolFormValue>(key: K, v: PoolFormValue[K]): void {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <Drawer title={pool ? 'Edit role' : 'New role'} onClose={onClose} dirty={dirty}>
      <div className="field">
        <label htmlFor="pool-name">Name (Emploi repère)</label>
        <input id="pool-name" autoFocus value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Animateur·trice" />
        {pool?.importName && pool.importName !== value.name && (
          <p className="field-hint">Imported as "{pool.importName}" — renaming here only changes the display name, a re-import will still match the original.</p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="pool-discipline">Discipline</label>
          <select
            id="pool-discipline"
            value={value.disciplineId ?? ''}
            onChange={(e) => set('disciplineId', e.target.value || null)}
          >
            <option value="">Unassigned</option>
            {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {pool && pool.importDisciplineId !== pool.disciplineId && (
            <p className="field-hint field-hint-warning">
              A remapping override is active — this role was imported into a different discipline.{' '}
              <button type="button" className="field-hint-reset" onClick={() => set('disciplineId', pool.importDisciplineId ?? null)}>Reset to imported discipline</button>
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="pool-color">Color</label>
          <input id="pool-color" type="color" value={value.color} onChange={(e) => set('color', e.target.value)} />
        </div>
      </div>

      {pool && otherPools && otherPools.length > 0 && onSetMoveRule && onClearMoveRule && (
        <div className="field">
          <label htmlFor="pool-move-rule">Move everyone in this role to…</label>
          {moveRule ? (
            <p className="field-hint">
              Everyone here is moved to <strong>{moveRule.targetPoolName}</strong>
              {!moveRule.targetPoolId && <span className="pill pill-warning pill-gap-left">target missing</span>}
              {' '}
              <button type="button" className="field-hint-reset" onClick={onClearMoveRule}>Clear</button>
            </p>
          ) : (
            <select id="pool-move-rule" value="" onChange={(e) => { if (e.target.value) onSetMoveRule(e.target.value); }}>
              <option value="">— No standing rule —</option>
              {otherPools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <p className="field-hint">A standing rule: everyone currently in this role moves to the target role. A person-level role override still wins over this rule.</p>
        </div>
      )}

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={() => onSave(value)}>
          {pool ? 'Save changes' : 'Create role'}
        </Button>
      </div>
    </Drawer>
  );
}
