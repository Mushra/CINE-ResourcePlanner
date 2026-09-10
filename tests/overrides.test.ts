import { describe, expect, it } from 'vitest';
import { applyStructureOverrides } from '../src/domain/overrides';
import { normalizeKey } from '../src/domain/identity';
import { discipline, person, planningData, pool, structureOverride } from './fixtures';

describe('applyStructureOverrides — effectiveDisciplineId', () => {
  it('defaults to the role\'s (native) discipline when no override applies', () => {
    const anim = discipline({ name: 'Animation' });
    const p = pool({ name: 'Animator', disciplineId: anim.id });
    const alice = person({ name: 'Alice', poolId: p.id });
    const data = planningData({ disciplines: [anim], pools: [p], people: [alice] });

    const result = applyStructureOverrides(data, []);
    expect(result.people[0].effectiveDisciplineId).toBe(anim.id);
  });

  it('relocates a person to another discipline via a person_discipline override, independent of their role', () => {
    const anim = discipline({ name: 'Animation' });
    const lighting = discipline({ name: 'Lighting' });
    const p = pool({ name: 'Animator', disciplineId: anim.id });
    const alice = person({ name: 'Alice', poolId: p.id });
    const data = planningData({ disciplines: [anim, lighting], pools: [p], people: [alice] });
    const overrides = [structureOverride({ kind: 'person_discipline', sourceKey: normalizeKey('Alice'), targetKey: normalizeKey('Lighting') })];

    const result = applyStructureOverrides(data, overrides);
    const effective = result.people[0];
    expect(effective.effectiveDisciplineId).toBe(lighting.id);
    // The role itself is untouched — the person keeps their pool.
    expect(effective.poolId).toBe(p.id);
  });

  it('falls back to the native discipline when the override target no longer exists', () => {
    const anim = discipline({ name: 'Animation' });
    const p = pool({ name: 'Animator', disciplineId: anim.id });
    const alice = person({ name: 'Alice', poolId: p.id });
    const data = planningData({ disciplines: [anim], pools: [p], people: [alice] });
    const overrides = [structureOverride({ kind: 'person_discipline', sourceKey: normalizeKey('Alice'), targetKey: normalizeKey('Deleted Discipline') })];

    const result = applyStructureOverrides(data, overrides);
    expect(result.people[0].effectiveDisciplineId).toBe(anim.id);
  });

  it('resolves the native discipline from the effective (post-person_pool-override) role, not the baseline one', () => {
    const anim = discipline({ name: 'Animation' });
    const lighting = discipline({ name: 'Lighting' });
    const animatorPool = pool({ name: 'Animator', disciplineId: anim.id });
    const lightingPool = pool({ name: 'Lighting Artist', disciplineId: lighting.id });
    const alice = person({ name: 'Alice', poolId: animatorPool.id });
    const data = planningData({ disciplines: [anim, lighting], pools: [animatorPool, lightingPool], people: [alice] });
    const overrides = [structureOverride({ kind: 'person_pool', sourceKey: normalizeKey('Alice'), targetKey: normalizeKey('Lighting Artist') })];

    const result = applyStructureOverrides(data, overrides);
    const effective = result.people[0];
    expect(effective.poolId).toBe(lightingPool.id);
    expect(effective.effectiveDisciplineId).toBe(lighting.id);
  });

  it('lets a person_discipline override win over the role\'s pool_discipline override', () => {
    const anim = discipline({ name: 'Animation' });
    const lighting = discipline({ name: 'Lighting' });
    const rigging = discipline({ name: 'Rigging' });
    const p = pool({ name: 'Animator', disciplineId: anim.id });
    const alice = person({ name: 'Alice', poolId: p.id });
    const data = planningData({ disciplines: [anim, lighting, rigging], pools: [p], people: [alice] });
    const overrides = [
      structureOverride({ kind: 'pool_discipline', sourceKey: normalizeKey('Animator'), targetKey: normalizeKey('Lighting') }),
      structureOverride({ kind: 'person_discipline', sourceKey: normalizeKey('Alice'), targetKey: normalizeKey('Rigging') }),
    ];

    const result = applyStructureOverrides(data, overrides);
    expect(result.people[0].effectiveDisciplineId).toBe(rigging.id);
  });
});
