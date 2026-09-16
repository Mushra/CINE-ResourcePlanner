import { useState } from 'react';
import { Button } from './Button';
import { pickContrastingColor } from '../lib/colors';
import type { Discipline } from '../../domain/types';

/** Sentinel <option> value for "+ New discipline…" — never a real discipline id. */
const NEW_DISCIPLINE_OPTION = '__new_discipline__';

/**
 * A discipline <select> with an inline "+ New discipline…" escape hatch: picking it swaps the
 * select for a compact name+color+Create row, and creating assigns the result immediately — so a
 * missing discipline never forces a detour through Team's own "New discipline" flow.
 */
export function DisciplinePicker({
  id, disciplines, value, emptyOption, onChange, onCreateDiscipline,
}: {
  id: string;
  disciplines: Discipline[];
  /** Current <select> value — a real discipline id, or emptyOption.value. */
  value: string;
  /** The non-discipline option shown first, e.g. {value: '', label: 'Unassigned'}. */
  emptyOption: { value: string; label: string };
  onChange: (rawValue: string) => void;
  onCreateDiscipline?: (input: { name: string; color: string }) => Discipline;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(() => pickContrastingColor(disciplines.map((d) => d.color)));

  function startCreating(): void {
    setColor(pickContrastingColor(disciplines.map((d) => d.color)));
    setName('');
    setCreating(true);
  }

  function create(): void {
    if (!onCreateDiscipline || !name.trim()) return;
    const discipline = onCreateDiscipline({ name: name.trim(), color });
    onChange(discipline.id);
    setCreating(false);
  }

  if (creating) {
    return (
      <div className="inline-discipline-create">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom de la discipline"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
        />
        <input type="color" aria-label="Discipline color" value={color} onChange={(e) => setColor(e.target.value)} />
        <Button variant="primary" size="sm" disabled={!name.trim()} onClick={create}>Create</Button>
        <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
      </div>
    );
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => (e.target.value === NEW_DISCIPLINE_OPTION ? startCreating() : onChange(e.target.value))}
    >
      <option value={emptyOption.value}>{emptyOption.label}</option>
      {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      {onCreateDiscipline && <option value={NEW_DISCIPLINE_OPTION}>+ New discipline…</option>}
    </select>
  );
}
