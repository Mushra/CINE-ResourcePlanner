import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import type { Discipline } from '../../domain/types';

export interface DisciplineFormValue {
  name: string;
  color: string;
}

const DEFAULT_COLOR = '#6b7280';

function fromDiscipline(discipline?: Discipline): DisciplineFormValue {
  if (!discipline) return { name: '', color: DEFAULT_COLOR };
  return { name: discipline.name, color: discipline.color };
}

export function DisciplineFormDrawer({
  discipline, onClose, onSave,
}: {
  discipline?: Discipline;
  onClose: () => void;
  onSave: (value: DisciplineFormValue) => void;
}) {
  const [value, setValue] = useState<DisciplineFormValue>(() => fromDiscipline(discipline));
  const [initialSnapshot] = useState(() => JSON.stringify(value));
  const canSave = value.name.trim().length > 0;
  const dirty = JSON.stringify(value) !== initialSnapshot;

  function set<K extends keyof DisciplineFormValue>(key: K, v: DisciplineFormValue[K]): void {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <Drawer title={discipline ? 'Edit discipline' : 'New discipline'} onClose={onClose} dirty={dirty}>
      <div className="field">
        <label htmlFor="discipline-name">Name (Famille d'emplois)</label>
        <input id="discipline-name" autoFocus value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Animation" />
        {discipline?.importName && discipline.importName !== value.name && (
          <p className="field-hint">Imported as "{discipline.importName}" — renaming here only changes the display name, a re-import will still match the original.</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="discipline-color">Color</label>
        <input id="discipline-color" type="color" value={value.color} onChange={(e) => set('color', e.target.value)} />
      </div>

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={() => onSave(value)}>
          {discipline ? 'Save changes' : 'Create discipline'}
        </Button>
      </div>
    </Drawer>
  );
}
