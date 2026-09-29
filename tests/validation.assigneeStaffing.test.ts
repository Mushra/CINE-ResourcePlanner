import { describe, expect, it } from 'vitest';
import { PlanningEngine } from '../src/engine/planning';
import { getSanityChecks } from '../src/engine/validation';
import { cinematic, discipline, jiraConfig, jiraSyncState, loq, person, personAssignment, planningData, project } from './fixtures';

/** Only the assignee↔staffing checks (the shared jira_inconsistency category also carries the
 * epic-divergence, binding-coherence and unmapped-status checks). */
function assigneeChecks(engine: PlanningEngine, projectId: string) {
  return getSanityChecks(engine, [jiraConfig({ projectId })])
    .filter((c) => c.id.startsWith('jira-assignee-'));
}

describe('getSanityChecks — Jira assignee ↔ plan staffing', () => {
  const animation = discipline({ name: 'Animation' });

  it('flags a Jira assignee that matches no person in the plan as info', () => {
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id });
    const state = jiraSyncState({ loqId: l1.id, jiraAssignee: 'Ghost Worker' });

    const engine = new PlanningEngine(planningData({
      disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state],
    }));
    const checks = assigneeChecks(engine, p1.id);
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('info');
    expect(checks[0].message).toContain('Ghost Worker');
    expect(checks[0].projectId).toBe(p1.id);
  });

  it('flags a matched person who is the Jira assignee but not staffed on the project as warning', () => {
    const p1 = project({ name: 'Alpha' });
    const eric = person({ name: 'Éric Dupont' }); // accented; assignee display name differs in order/case
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id });
    const state = jiraSyncState({ loqId: l1.id, jiraAssignee: 'dupont eric' });

    const engine = new PlanningEngine(planningData({
      disciplines: [animation], projects: [p1], people: [eric], cinematics: [cine], loqs: [l1], jiraSyncStates: [state],
    }));
    const checks = assigneeChecks(engine, p1.id);
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('warning');
    expect(checks[0].personId).toBe(eric.id);
    expect(checks[0].message).toContain('Éric Dupont');
  });

  it('stays silent when the matched assignee is staffed on the project', () => {
    const p1 = project({ name: 'Alpha' });
    const eric = person({ name: 'Éric Dupont' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id });
    const state = jiraSyncState({ loqId: l1.id, jiraAssignee: 'Éric Dupont' });
    const asn = personAssignment(eric.id, p1.id, { '2026-11': 1 });

    const engine = new PlanningEngine(planningData({
      disciplines: [animation], projects: [p1], people: [eric], cinematics: [cine], loqs: [l1],
      jiraSyncStates: [state], personAssignments: [asn.personAssignment], personAssignmentAllocations: asn.allocations,
    }));
    expect(assigneeChecks(engine, p1.id)).toHaveLength(0);
  });

  it('aggregates multiple LOQs of the same project/assignee into a single finding', () => {
    const p1 = project({ name: 'Alpha' });
    const eric = person({ name: 'Éric Dupont' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L1' });
    const l2 = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L2' });
    const s1 = jiraSyncState({ loqId: l1.id, jiraAssignee: 'Éric Dupont' });
    const s2 = jiraSyncState({ loqId: l2.id, jiraAssignee: 'Éric Dupont' });

    const engine = new PlanningEngine(planningData({
      disciplines: [animation], projects: [p1], people: [eric], cinematics: [cine], loqs: [l1, l2], jiraSyncStates: [s1, s2],
    }));
    expect(assigneeChecks(engine, p1.id)).toHaveLength(1);
  });

  it('stays silent for a terminal (Done) LOQ', () => {
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, jiraKey: 'OVR-2' }); // bound, so the 'Done' snapshot drives the effective status
    const state = jiraSyncState({ loqId: l1.id, jiraAssignee: 'Ghost Worker', jiraStatus: 'Done' });

    const engine = new PlanningEngine(planningData({
      disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], jiraSyncStates: [state],
    }));
    expect(assigneeChecks(engine, p1.id)).toHaveLength(0);
  });
});
