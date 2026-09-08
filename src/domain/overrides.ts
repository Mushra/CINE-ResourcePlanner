import type { Discipline, Person, PlanningData, Project, ResourcePool } from './types';
import { normalizeKey } from './identity';

/**
 * Applies name-keyed structure overrides on top of the raw imported/edited data, producing the
 * "effective" disciplines/pools/people/projects the rest of the app sees. Never writes
 * disciplineId/poolId/name back to the baseline — every edit view (Team, Structure, Projects)
 * edits this overlay — so overrides survive a re-import (which only ever matches/merges rows by
 * name, never touches structure_overrides). The pre-override value is preserved on
 * importDisciplineId/importPoolId/importName for "origine" display and for keying further renames.
 *
 * Rename overrides (`*_name` kinds) are resolved last, after the structural remaps above, so those
 * remaps keep matching on the frozen, import-matched name rather than a display rename.
 */
export function applyStructureOverrides(data: PlanningData, overrides: PlanningData['structureOverrides']): PlanningData {
  const disciplineByKey = new Map(data.disciplines.map((d) => [normalizeKey(d.name), d] as const));
  const poolByKey = new Map(data.pools.map((p) => [normalizeKey(p.name), p] as const));
  const poolByIdOriginal = new Map(data.pools.map((p) => [p.id, p] as const));

  const poolDisciplineOverride = new Map<string, string>();
  const personPoolOverride = new Map<string, string>();
  const poolPersonPoolOverride = new Map<string, string>();
  const disciplineNameOverride = new Map<string, string>();
  const poolNameOverride = new Map<string, string>();
  const personNameOverride = new Map<string, string>();
  const projectNameOverride = new Map<string, string>();
  for (const o of overrides) {
    if (o.kind === 'pool_discipline') poolDisciplineOverride.set(o.sourceKey, o.targetKey);
    else if (o.kind === 'person_pool') personPoolOverride.set(o.sourceKey, o.targetKey);
    else if (o.kind === 'pool_person_pool') poolPersonPoolOverride.set(o.sourceKey, o.targetKey);
    else if (o.kind === 'discipline_name') disciplineNameOverride.set(o.sourceKey, o.targetKey);
    else if (o.kind === 'pool_name') poolNameOverride.set(o.sourceKey, o.targetKey);
    else if (o.kind === 'person_name') personNameOverride.set(o.sourceKey, o.targetKey);
    else if (o.kind === 'project_name') projectNameOverride.set(o.sourceKey, o.targetKey);
  }

  const disciplines: Discipline[] = data.disciplines.map((discipline) => {
    const renamed = disciplineNameOverride.get(normalizeKey(discipline.name));
    return renamed ? { ...discipline, importName: discipline.name, name: renamed } : { ...discipline, importName: discipline.name };
  });

  const poolsStructural: ResourcePool[] = data.pools.map((pool) => {
    const targetKey = poolDisciplineOverride.get(normalizeKey(pool.name));
    if (!targetKey) return { ...pool, importDisciplineId: pool.disciplineId };
    const targetDiscipline = disciplineByKey.get(targetKey);
    return { ...pool, importDisciplineId: pool.disciplineId, disciplineId: targetDiscipline ? targetDiscipline.id : pool.disciplineId };
  });
  const pools: ResourcePool[] = poolsStructural.map((pool) => {
    const renamed = poolNameOverride.get(normalizeKey(pool.name));
    return renamed ? { ...pool, importName: pool.name, name: renamed } : { ...pool, importName: pool.name };
  });

  const peopleStructural: Person[] = data.people.map((person) => {
    const originalPool = person.poolId ? poolByIdOriginal.get(person.poolId) : undefined;
    const targetKey = personPoolOverride.get(normalizeKey(person.name))
      ?? (originalPool ? poolPersonPoolOverride.get(normalizeKey(originalPool.name)) : undefined);
    if (!targetKey) return { ...person, importPoolId: person.poolId };
    const targetPool = poolByKey.get(targetKey);
    return { ...person, importPoolId: person.poolId, poolId: targetPool ? targetPool.id : person.poolId };
  });
  const people: Person[] = peopleStructural.map((person) => {
    const renamed = personNameOverride.get(normalizeKey(person.name));
    return renamed ? { ...person, importName: person.name, name: renamed } : { ...person, importName: person.name };
  });

  const projects: Project[] = data.projects.map((project) => {
    const renamed = projectNameOverride.get(normalizeKey(project.name));
    return renamed ? { ...project, importName: project.name, name: renamed } : { ...project, importName: project.name };
  });

  return { ...data, disciplines, pools, people, projects };
}
