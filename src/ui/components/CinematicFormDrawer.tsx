import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import type { Cinematic } from '../../domain/types';

export interface CinematicFormValue {
  name: string;
  jiraKey: string | null;
  targetDate: string | null;
  notes: string;
  paused: boolean;
}

function fromCinematic(cinematic?: Cinematic): CinematicFormValue {
  if (!cinematic) return { name: '', jiraKey: null, targetDate: null, notes: '', paused: false };
  return { name: cinematic.name, jiraKey: cinematic.jiraKey, targetDate: cinematic.targetDate, notes: cinematic.notes, paused: cinematic.paused };
}

export function CinematicFormDrawer({ cinematic, onClose, onSave }: { cinematic?: Cinematic; onClose: () => void; onSave: (value: CinematicFormValue) => void }) {
  const [value, setValue] = useState<CinematicFormValue>(() => fromCinematic(cinematic));
  const [initialSnapshot] = useState(() => JSON.stringify(value));
  const canSave = value.name.trim().length > 0;
  const dirty = JSON.stringify(value) !== initialSnapshot;

  function set<K extends keyof CinematicFormValue>(key: K, v: CinematicFormValue[K]): void {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <Drawer title={cinematic ? 'Edit cinematic' : 'New cinematic'} onClose={onClose} dirty={dirty}>
      <div className="field">
        <label htmlFor="cine-name">Name</label>
        <input id="cine-name" autoFocus value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Seq01" />
      </div>

      <div className="field">
        <label htmlFor="cine-target">Target date</label>
        <input id="cine-target" type="date" value={value.targetDate ?? ''} onChange={(e) => set('targetDate', e.target.value || null)} />
      </div>

      <div className="field">
        <label htmlFor="cine-jira">Jira key</label>
        <input id="cine-jira" value={value.jiraKey ?? ''} onChange={(e) => set('jiraKey', e.target.value || null)} placeholder="PROD-100" />
      </div>

      <div className="field">
        <label htmlFor="cine-notes">Notes</label>
        <textarea id="cine-notes" rows={4} value={value.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Context, references…" />
      </div>

      <div className="field field-checkbox">
        <label htmlFor="cine-paused">
          <input id="cine-paused" type="checkbox" checked={value.paused} onChange={(e) => set('paused', e.target.checked)} />
          Paused
        </label>
      </div>

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={() => onSave(value)}>
          {cinematic ? 'Save changes' : 'Create cinematic'}
        </Button>
      </div>
    </Drawer>
  );
}
