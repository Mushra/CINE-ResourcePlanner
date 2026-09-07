import type { Person, PlanningData, ResourcePool } from './types';
import { normalizeKey } from './identity';

/**
 * Applies name-keyed structure overrides on top of the raw imported/edited data, producing the
 * "effective" pools/people the rest of the app sees. Never writes disciplineId/poolId back to
 * the baseline — Team edits the baseline, Structure edits this overlay — so overrides survive a
 * re-import (which only ever matches/merges rows by name, never touches structure_overrides).
 * The pre-override value is preserved on importDisciplineId/importPoolId for "origine" display.
 */
export function applyStructureOverrides(data: PlanningData, overrides: PlanningData['structureOverrides']): PlanningData {
  const disciplineByKey = new Map(data.disciplines.map((d) => [normalizeKey(d.name), d] as const));
  const poolByKey = new Map(data.pools.map((p) => [normalizeKey(p.name), p] as const));
  const poolByIdOriginal = new Map(data.pools.map((p) => [p.id, p] as const));

  const poolDisciplineOverride = new Map<string, string>();
  const personPoolOverride = new Map<string, string>();
  const poolPersonPoolOverride = new Map<string, string>();
  for (const o of overrides) {
    if (o.kind === 'pool_discipline') poolDisciplineOverride.set(o.sourceKey, o.targetKey);
    else if (o.kind === 'person_pool') personPoolOverride.set(o.sourceKey, o.targetKey);
    else if (o.kind === 'pool_person_pool') poolPersonPoolOverride.set(o.sourceKey, o.targetKey);
  }

  const pools: ResourcePool[] = data.pools.map((pool) => {
    const targetKey = poolDisciplineOverride.get(normalizeKey(pool.name));
    if (!targetKey) return { ...pool, importDisciplineId: pool.disciplineId };
    const targetDiscipline = disciplineByKey.get(targetKey);
    return { ...pool, importDisciplineId: pool.disciplineId, disciplineId: targetDiscipline ? targetDiscipline.id : pool.disciplineId };
  });

  const people: Person[] = data.people.map((person) => {
    const originalPool = person.poolId ? poolByIdOriginal.get(person.poolId) : undefined;
    const targetKey = personPoolOverride.get(normalizeKey(person.name))
      ?? (originalPool ? poolPersonPoolOverride.get(normalizeKey(originalPool.name)) : undefined);
    if (!targetKey) return { ...person, importPoolId: person.poolId };
    const targetPool = poolByKey.get(targetKey);
    return { ...person, importPoolId: person.poolId, poolId: targetPool ? targetPool.id : person.poolId };
  });

  return { ...data, pools, people };
}
