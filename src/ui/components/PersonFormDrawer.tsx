import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import { NumberField } from './NumberField';
import type { Person, ResourcePool } from '../../domain/types';

export interface PersonFormValue {
  name: string;
  poolId: string | null;
  capacityFte: number;
  active: boolean;
  notes: string;
}

function fromPerson(person?: Person, defaultPoolId?: string | null): PersonFormValue {
  if (!person) return { name: '', poolId: defaultPoolId ?? null, capacityFte: 1, active: true, notes: '' };
  return { name: person.name, poolId: person.poolId, capacityFte: person.capacityFte, active: person.active, notes: person.notes };
}

export function PersonFormDrawer({
  person, pools, defaultPoolId, onClose, onSave,
}: {
  person?: Person;
  pools: ResourcePool[];
  defaultPoolId?: string | null;
  onClose: () => void;
  onSave: (value: PersonFormValue) => void;
}) {
  const [value, setValue] = useState<PersonFormValue>(() => fromPerson(person, defaultPoolId));
  const canSave = value.name.trim().length > 0;

  function set<K extends keyof PersonFormValue>(key: K, v: PersonFormValue[K]): void {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <Drawer title={person ? 'Edit person' : 'New person'} onClose={onClose}>
      <div className="field">
        <label htmlFor="person-name">Name (Ressource affectée)</label>
        <input id="person-name" autoFocus value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Doe" />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="person-pool">Role</label>
          <select id="person-pool" value={value.poolId ?? ''} onChange={(e) => set('poolId', e.target.value || null)}>
            <option value="">Unassigned</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="person-capacity">Capacity (FTE)</label>
          <NumberField value={value.capacityFte} onCommit={(v) => set('capacityFte', v)} step={0.1} min={0} />
        </div>
      </div>

      <div className="field field-checkbox">
        <label htmlFor="person-active">
          <input id="person-active" type="checkbox" checked={value.active} onChange={(e) => set('active', e.target.checked)} />
          Active
        </label>
      </div>

      <div className="field">
        <label htmlFor="person-notes">Notes</label>
        <textarea id="person-notes" value={value.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
      </div>

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={() => onSave(value)}>
          {person ? 'Save changes' : 'Add person'}
        </Button>
      </div>
    </Drawer>
  );
}
