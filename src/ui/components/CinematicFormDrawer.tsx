import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import type { Cinematic } from '../../domain/types';

export interface CinematicFormValue {
  name: string;
  targetDate: string | null;
  notes: string;
}

function fromCinematic(cinematic?: Cinematic): CinematicFormValue {
  if (!cinematic) return { name: '', targetDate: null, notes: '' };
  return { name: cinematic.name, targetDate: cinematic.targetDate, notes: cinematic.notes };
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
        <label htmlFor="cine-notes">Notes</label>
        <textarea id="cine-notes" rows={4} value={value.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Context, references…" />
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
