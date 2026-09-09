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
  team: string;
  site: string;
}

function fromPerson(person?: Person, defaultPoolId?: string | null): PersonFormValue {
  if (!person) return { name: '', poolId: defaultPoolId ?? null, capacityFte: 1, active: true, notes: '', team: '', site: '' };
  return {
    name: person.name, poolId: person.poolId, capacityFte: person.capacityFte, active: person.active,
    notes: person.notes, team: person.team, site: person.site,
  };
}

export function PersonFormDrawer({
  person, pools, defaultPoolId, teamOptions, siteOptions, onClose, onSave,
}: {
  person?: Person;
  pools: ResourcePool[];
  defaultPoolId?: string | null;
  teamOptions?: string[];
  siteOptions?: string[];
  onClose: () => void;
  onSave: (value: PersonFormValue) => void;
}) {
  const [value, setValue] = useState<PersonFormValue>(() => fromPerson(person, defaultPoolId));
  const [initialSnapshot] = useState(() => JSON.stringify(value));
  const canSave = value.name.trim().length > 0;
  const dirty = JSON.stringify(value) !== initialSnapshot;

  function set<K extends keyof PersonFormValue>(key: K, v: PersonFormValue[K]): void {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <Drawer title={person ? 'Edit person' : 'New person'} onClose={onClose} dirty={dirty}>
      <div className="field">
        <label htmlFor="person-name">Name (Ressource affectée)</label>
        <input id="person-name" autoFocus value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Doe" />
        {person?.importName && person.importName !== value.name && (
          <p className="field-hint">Imported as "{person.importName}" — renaming here only changes the display name, a re-import will still match the original.</p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="person-pool">Role</label>
          <select id="person-pool" value={value.poolId ?? ''} onChange={(e) => set('poolId', e.target.value || null)}>
            <option value="">Unassigned</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {person && person.importPoolId !== person.poolId && (
            <p className="field-hint field-hint-warning">
              A Structure override or role-remap rule currently controls this person's role and takes precedence — changing this field here has no visible effect until you clear it in Structure.
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="person-capacity">Capacity (FTE)</label>
          <NumberField value={value.capacityFte} onCommit={(v) => set('capacityFte', v)} step={0.1} min={0} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="person-team">Team</label>
        <input id="person-team" list="team-options" value={value.team} onChange={(e) => set('team', e.target.value)} placeholder="Team name" />
        {teamOptions && teamOptions.length > 0 && (
          <datalist id="team-options">
            {teamOptions.map((t) => <option key={t} value={t} />)}
          </datalist>
        )}
      </div>

      <div className="field">
        <label htmlFor="person-site">Site</label>
        <input id="person-site" list="site-options" value={value.site} onChange={(e) => set('site', e.target.value)} placeholder="Studio / location" />
        {siteOptions && siteOptions.length > 0 && (
          <datalist id="site-options">
            {siteOptions.map((s) => <option key={s} value={s} />)}
          </datalist>
        )}
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
