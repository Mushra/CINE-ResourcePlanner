import { describe, expect, it } from 'vitest';
import { computeTemplateEdges } from '../src/domain/dependencyFlow';
import type { DependencyTemplate } from '../src/domain/types';
import { loq, loqDependency } from './fixtures';

const CINE = 'cine-1';
const D_TECH = 'd-tech';
const D_ANIM = 'd-anim';

function tpl(over: Partial<DependencyTemplate> = {}): DependencyTemplate {
  return {
    id: 'tpl-1',
    predecessorDisciplineId: D_TECH,
    predecessorLoqType: 'L0',
    successorDisciplineId: D_ANIM,
    successorLoqType: 'L0',
    type: 'finish_to_start',
    lagDays: 0,
    ...over,
  };
}

describe('computeTemplateEdges', () => {
  it('materializes one edge per matching (predecessor, successor) pair in the cinematic', () => {
    const tech = loq({ id: 'tech', cinematicId: CINE, disciplineId: D_TECH, type: 'L0' });
    const anim = loq({ id: 'anim', cinematicId: CINE, disciplineId: D_ANIM, type: 'L0' });
    const edges = computeTemplateEdges([tech, anim], [tpl({ lagDays: 2 })], []);
    expect(edges).toEqual([
      { predecessorLoqId: 'tech', successorLoqId: 'anim', type: 'finish_to_start', lagDays: 2, templateId: 'tpl-1' },
    ]);
  });

  it('does not match when the LOQ level differs from the template level', () => {
    const tech = loq({ id: 'tech', cinematicId: CINE, disciplineId: D_TECH, type: 'L1' }); // template wants L0
    const anim = loq({ id: 'anim', cinematicId: CINE, disciplineId: D_ANIM, type: 'L0' });
    expect(computeTemplateEdges([tech, anim], [tpl()], [])).toEqual([]);
  });

  it('matches the level case- and whitespace-insensitively', () => {
    const tech = loq({ id: 'tech', cinematicId: CINE, disciplineId: D_TECH, type: ' mocap prep ' });
    const anim = loq({ id: 'anim', cinematicId: CINE, disciplineId: D_ANIM, type: 'L0' });
    const edges = computeTemplateEdges([tech, anim], [tpl({ predecessorLoqType: 'Mocap Prep' })], []);
    expect(edges.map((e) => [e.predecessorLoqId, e.successorLoqId])).toEqual([['tech', 'anim']]);
  });

  it('produces the cross product when several LOQs match an endpoint', () => {
    const tech = loq({ id: 'tech', cinematicId: CINE, disciplineId: D_TECH, type: 'L0' });
    const animA = loq({ id: 'animA', cinematicId: CINE, disciplineId: D_ANIM, type: 'L0' });
    const animB = loq({ id: 'animB', cinematicId: CINE, disciplineId: D_ANIM, type: 'L0' });
    const edges = computeTemplateEdges([tech, animA, animB], [tpl()], []);
    expect(edges.map((e) => e.successorLoqId)).toEqual(['animA', 'animB']);
  });

  it('chains across templates (Mocap Prep → Tech Anim → Anim), all within one cinematic', () => {
    const mocap = loq({ id: 'mocap', cinematicId: CINE, disciplineId: 'd-mocap', type: 'Prep' });
    const tech = loq({ id: 'tech', cinematicId: CINE, disciplineId: D_TECH, type: 'L0' });
    const anim = loq({ id: 'anim', cinematicId: CINE, disciplineId: D_ANIM, type: 'L0' });
    const templates = [
      tpl({ id: 't-mocap', predecessorDisciplineId: 'd-mocap', predecessorLoqType: 'Prep', successorDisciplineId: D_TECH, successorLoqType: 'L0' }),
      tpl({ id: 't-tech', predecessorDisciplineId: D_TECH, predecessorLoqType: 'L0', successorDisciplineId: D_ANIM, successorLoqType: 'L0' }),
    ];
    const edges = computeTemplateEdges([mocap, tech, anim], templates, []);
    expect(edges.map((e) => [e.predecessorLoqId, e.successorLoqId, e.templateId])).toEqual([
      ['mocap', 'tech', 't-mocap'],
      ['tech', 'anim', 't-tech'],
    ]);
  });

  it('skips a pair already owned by a non-template edge — override/jira always wins', () => {
    const tech = loq({ id: 'tech', cinematicId: CINE, disciplineId: D_TECH, type: 'L0' });
    const anim = loq({ id: 'anim', cinematicId: CINE, disciplineId: D_ANIM, type: 'L0' });
    const owned = loqDependency({ predecessorLoqId: 'tech', successorLoqId: 'anim', source: 'override', lagDays: 5 });
    expect(computeTemplateEdges([tech, anim], [tpl()], [owned])).toEqual([]);
  });

  it('skips a template edge that would close a cycle against surviving edges', () => {
    const tech = loq({ id: 'tech', cinematicId: CINE, disciplineId: D_TECH, type: 'L0' });
    const anim = loq({ id: 'anim', cinematicId: CINE, disciplineId: D_ANIM, type: 'L0' });
    // Existing override anim → tech; the template would add tech → anim (the reverse) → a cycle.
    const owned = loqDependency({ predecessorLoqId: 'anim', successorLoqId: 'tech', source: 'override' });
    expect(computeTemplateEdges([tech, anim], [tpl()], [owned])).toEqual([]);
  });

  it('never creates a self-edge when both template ends match the same LOQ', () => {
    const self = loq({ id: 'self', cinematicId: CINE, disciplineId: D_ANIM, type: 'L0' });
    const sameEnds = tpl({ predecessorDisciplineId: D_ANIM, predecessorLoqType: 'L0', successorDisciplineId: D_ANIM, successorLoqType: 'L0' });
    expect(computeTemplateEdges([self], [sameEnds], [])).toEqual([]);
  });
});
