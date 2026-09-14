import { useStore } from '../../store/useStore';
import { normalizeKey } from '../../domain/identity';
import type { Person } from '../../domain/types';
import type { PersonFormValue } from '../components/PersonFormDrawer';

/**
 * Structural edits made through the person form (role, discipline) never mutate the imported
 * baseline — they set/clear a name-keyed structure_overrides row instead, so they survive an RPM
 * re-import. See src/domain/overrides.ts. Shared by Team and PersonDetail so both save identically.
 */
export function usePersonSave(): { savePersonEdit: (original: Person | undefined, value: PersonFormValue) => void } {
  const pools = useStore((s) => s.data.pools);
  const disciplines = useStore((s) => s.data.disciplines);
  const createPerson = useStore((s) => s.createPerson);
  const updatePerson = useStore((s) => s.updatePerson);
  const setPersonPool = useStore((s) => s.setPersonPool);
  const setPersonDiscipline = useStore((s) => s.setPersonDiscipline);
  const clearOverrideByKey = useStore((s) => s.clearOverrideByKey);

  function savePersonEdit(original: Person | undefined, value: PersonFormValue): void {
    if (!original) { createPerson({ name: value.name, poolId: value.poolId, capacityFte: value.capacityFte, active: value.active, notes: value.notes, team: value.team, site: value.site }); return; }
    const baselinePoolId = original.importPoolId ?? original.poolId;
    const chosenPool = value.poolId ? pools.find((p) => p.id === value.poolId) : null;
    if (chosenPool && chosenPool.id !== baselinePoolId) setPersonPool(original.name, chosenPool.name);
    else clearOverrideByKey('person_pool', normalizeKey(original.name));

    const chosenDiscipline = value.disciplineId ? disciplines.find((d) => d.id === value.disciplineId) : null;
    if (chosenDiscipline) setPersonDiscipline(original.name, chosenDiscipline.name);
    else clearOverrideByKey('person_discipline', normalizeKey(original.name));

    updatePerson({
      ...original, name: value.name, poolId: baselinePoolId, capacityFte: value.capacityFte,
      active: value.active, notes: value.notes, team: value.team, site: value.site,
    });
  }

  return { savePersonEdit };
}
