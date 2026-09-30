import { describe, expect, it } from 'vitest';
import { useStore } from '../../src/store/useStore';
import { getSanityChecks } from '../../src/engine/validation';
import { seedStore, seedDemoStore } from './harness';

/** Repro for the reported bug: editing needs/assignments in the Staffing view should clear the
 * staffing warnings live. Exercises the real store→persist→reload→engine path the UI uses. */
describe('staffing warnings recompute after an edit', () => {
  it('clears an understaffed/unstaffed warning once the discipline is assigned to cover its need', async () => {
    await seedStore();
    const s = useStore.getState();
    const discipline = s.createDiscipline({ name: 'Animation', color: '#4f7cff' });
    const project = s.createProject({
      name: 'Alpha', status: 'planned', startDate: '2026-09-01', startCertainty: 'confirmed',
      endDate: '2026-09-30', endCertainty: 'confirmed', priority: 'medium', notes: '', isDispo: false,
    });
    const pool = s.createPool({ name: 'Animator', color: '#4f7cff', disciplineId: discipline.id, capacityFte: 0 });
    const person = s.createPerson({ name: 'Ada Lovelace', poolId: pool.id, capacityFte: 1, active: true, notes: '', team: '', site: '' });

    // Need 1 FTE of Animation in Sep, nobody assigned yet.
    useStore.getState().setDisciplineRequirement(project.id, discipline.id, '2026-09', 1);
    const before = getSanityChecks(useStore.getState().engine).filter((c) => c.projectId === project.id);
    expect(before.some((c) => c.category === 'unstaffed_requirement' && c.disciplineId === discipline.id)).toBe(true);

    // Assign the person to cover it — the warning should be gone from the freshly recomputed checks.
    useStore.getState().setPersonAssignment(person.id, project.id, '2026-09', 1);
    const after = getSanityChecks(useStore.getState().engine).filter((c) => c.projectId === project.id);
    expect(after.some((c) => c.category === 'unstaffed_requirement' && c.disciplineId === discipline.id)).toBe(false);
    expect(after.some((c) => c.category === 'understaffed_project' && c.disciplineId === discipline.id)).toBe(false);
  });

  it('lowers a requirement recorded on a SPECIFIC pool when edited from the discipline need lane', async () => {
    // The demo seed records Animation's need directly on the specific "Animation" pool
    // (setRequired(alpha, animation.id, ...)) — exactly like an MS Project import.
    await seedDemoStore();
    const { engine } = useStore.getState();
    const project = engine.projects().find((p) => p.name === 'Cinematic Alpha')!;
    const discipline = engine.disciplines().find((d) => d.name === 'Animation')!;

    // The need lane shows the discipline-aggregated required = 1 in Sep.
    const requiredBefore = useStore.getState().engine.getProjectDisciplineStaffing(project.id, '2026-09')
      .find((l) => l.disciplineId === discipline.id)?.required ?? 0;
    expect(requiredBefore).toBe(1);

    // The user drags the need down to 0 — the lane calls setDisciplineRequirementRange (generic pool).
    useStore.getState().setDisciplineRequirementRange(project.id, discipline.id, ['2026-09'], 0);

    const requiredAfter = useStore.getState().engine.getProjectDisciplineStaffing(project.id, '2026-09')
      .find((l) => l.disciplineId === discipline.id)?.required ?? 0;
    // The edit consolidates the specific-pool need onto the discipline's generic pool first, so the
    // aggregated required actually drops to 0 (previously it stayed at 1 — the bug).
    expect(requiredAfter).toBe(0);

    // Other months keep their (folded) needs — only Sep was edited.
    const octAfter = useStore.getState().engine.getProjectDisciplineStaffing(project.id, '2026-10')
      .find((l) => l.disciplineId === discipline.id)?.required ?? 0;
    expect(octAfter).toBe(2);
  });
});
