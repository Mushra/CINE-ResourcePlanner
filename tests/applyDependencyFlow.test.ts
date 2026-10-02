import { describe, expect, it } from 'vitest';
import { PlannerDatabase } from '../src/db/database';
import { materializeAllFlow, materializeCinematicFlow } from '../src/db/applyDependencyFlow';
import {
  createCinematic,
  createDependencyTemplate,
  createDiscipline,
  createLoq,
  createLoqDependency,
  createProject,
  deleteDependencyTemplate,
  loadPlanningData,
  updateDependencyTemplate,
} from '../src/db/repository';

function seedProject(db: PlannerDatabase, name = 'Movie A') {
  return createProject(db, { name, status: 'active', startDate: null, startCertainty: 'tbd', endDate: null, endCertainty: 'tbd', priority: 'medium', notes: '', isDispo: false });
}

/** Seeds a project with Tech Anim + Anim disciplines and one cinematic holding a Tech-L0 and an
 * Anim-L0 LOQ, plus a template (Tech L0 → Anim L0). Returns the ids and a dep-row reader. */
function seedFlow(db: PlannerDatabase) {
  const project = seedProject(db);
  const tech = createDiscipline(db, { name: 'Tech Anim', color: '#111' });
  const anim = createDiscipline(db, { name: 'Anim', color: '#222' });
  const cine = createCinematic(db, { projectId: project.id, name: 'Seq010', jiraKey: null, targetDate: null, notes: '' });
  const mk = (disciplineId: string, type: string) =>
    createLoq(db, { cinematicId: cine.id, disciplineId, jiraKey: null, type, status: 'TODO', estimateDays: 3, committedStart: null, committedFinish: null, actualFinish: null, dodRef: '' });
  const techLoq = mk(tech.id, 'L0');
  const animLoq = mk(anim.id, 'L0');
  const template = createDependencyTemplate(db, {
    predecessorDisciplineId: tech.id, predecessorLoqType: 'L0', successorDisciplineId: anim.id, successorLoqType: 'L0', type: 'finish_to_start', lagDays: 0,
  });
  const deps = () =>
    loadPlanningData(db).loqDependencies.map((d) => ({ pred: d.predecessorLoqId, succ: d.successorLoqId, source: d.source, lagDays: d.lagDays, templateId: d.templateId }));
  return { project, tech, anim, cine, techLoq, animLoq, template, deps };
}

describe('materializeCinematicFlow', () => {
  it('materializes a template into a concrete source=template edge, carrying its lag + templateId', async () => {
    const db = await PlannerDatabase.createNew();
    const { cine, techLoq, animLoq, template, deps } = seedFlow(db);

    const res = materializeCinematicFlow(db, cine.id);
    expect(res).toEqual({ created: 1, changed: true });
    expect(deps()).toEqual([{ pred: techLoq.id, succ: animLoq.id, source: 'template', lagDays: 0, templateId: template.id }]);
  });

  it('is a no-op on the second call — nothing changed, nothing rewritten', async () => {
    const db = await PlannerDatabase.createNew();
    const { cine, deps } = seedFlow(db);

    materializeCinematicFlow(db, cine.id);
    const before = deps();
    const res = materializeCinematicFlow(db, cine.id);
    expect(res).toEqual({ created: 0, changed: false });
    expect(deps()).toEqual(before);
  });

  it('re-materializes when a template lag changes (same pair, different lag)', async () => {
    const db = await PlannerDatabase.createNew();
    const { cine, template, deps } = seedFlow(db);

    materializeCinematicFlow(db, cine.id);
    updateDependencyTemplate(db, { ...template, lagDays: 4 });
    const res = materializeCinematicFlow(db, cine.id);
    expect(res.changed).toBe(true);
    expect(deps().map((d) => d.lagDays)).toEqual([4]);
  });

  it('drops the materialized edge once its template is deleted', async () => {
    const db = await PlannerDatabase.createNew();
    const { cine, template, deps } = seedFlow(db);

    materializeCinematicFlow(db, cine.id);
    expect(deps()).toHaveLength(1);
    deleteDependencyTemplate(db, template.id);
    const res = materializeCinematicFlow(db, cine.id);
    expect(res).toEqual({ created: 0, changed: true });
    expect(deps()).toEqual([]);
  });

  it('never overwrites an override edge on the same pair (and makes no template edge there)', async () => {
    const db = await PlannerDatabase.createNew();
    const { cine, techLoq, animLoq, deps } = seedFlow(db);
    createLoqDependency(db, { predecessorLoqId: techLoq.id, successorLoqId: animLoq.id, type: 'finish_to_start', lagDays: 5, source: 'override', templateId: null });

    const res = materializeCinematicFlow(db, cine.id);
    expect(res).toEqual({ created: 0, changed: false }); // the pair is owned → nothing to materialize
    expect(deps()).toEqual([{ pred: techLoq.id, succ: animLoq.id, source: 'override', lagDays: 5, templateId: null }]);
  });

  it('materializes nothing for a cinematic whose LOQs do not fit any template', async () => {
    const db = await PlannerDatabase.createNew();
    const { tech, anim, project, deps } = seedFlow(db);
    // A second cinematic with only an Anim L0 (no Tech predecessor) → no edge.
    const other = createCinematic(db, { projectId: project.id, name: 'Seq020', jiraKey: null, targetDate: null, notes: '' });
    createLoq(db, { cinematicId: other.id, disciplineId: anim.id, jiraKey: null, type: 'L0', status: 'TODO', estimateDays: 3, committedStart: null, committedFinish: null, actualFinish: null, dodRef: '' });
    void tech;

    expect(materializeCinematicFlow(db, other.id)).toEqual({ created: 0, changed: false });
    expect(deps()).toEqual([]);
  });
});

describe('materializeAllFlow', () => {
  it('materializes every cinematic and scopes each replace to its own LOQs', async () => {
    const db = await PlannerDatabase.createNew();
    const { project, tech, anim, cine, deps } = seedFlow(db);
    // A second cinematic with its own Tech-L0/Anim-L0 pair → the same global template applies.
    const cineB = createCinematic(db, { projectId: project.id, name: 'Seq020', jiraKey: null, targetDate: null, notes: '' });
    const mk = (disciplineId: string, type: string) =>
      createLoq(db, { cinematicId: cineB.id, disciplineId, jiraKey: null, type, status: 'TODO', estimateDays: 3, committedStart: null, committedFinish: null, actualFinish: null, dodRef: '' });
    mk(tech.id, 'L0');
    mk(anim.id, 'L0');

    const res = materializeAllFlow(db);
    expect(res).toEqual({ created: 2, cinematicsChanged: 2 });
    expect(deps().filter((d) => d.source === 'template')).toHaveLength(2);

    // Re-materializing cinematic A alone leaves B's edge untouched (per-cinematic scoping).
    expect(materializeCinematicFlow(db, cine.id)).toEqual({ created: 0, changed: false });
    expect(deps().filter((d) => d.source === 'template')).toHaveLength(2);
  });
});
