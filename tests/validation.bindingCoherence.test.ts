import { describe, expect, it } from 'vitest';
import { PlanningEngine } from '../src/engine/planning';
import { getSanityChecks } from '../src/engine/validation';
import { cinematic, cinematicJiraSyncState, discipline, jiraConfig, jiraSyncState, loq, planningData, project } from './fixtures';

/** Only the binding-coherence checks (the shared jira_inconsistency category also carries the
 * epic-divergence and unmapped-status checks, which key on different ids). */
function coherenceChecks(engine: PlanningEngine, projectId: string) {
  return getSanityChecks(engine, [jiraConfig({ projectId })])
    .filter((c) => c.id.startsWith('cinematic-binding-coherence'));
}

describe('getSanityChecks — Cinematic binding coherence', () => {
  it('flags a Cinematic bound to an issue that carries no Cinematics List value (the "task named like the cin" case)', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id, name: 'Seq010 Opening', jiraKey: 'OVR-1' });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id }); // a shot exists, but none bound yet
    const epicState = cinematicJiraSyncState({
      cinematicId: cine.id,
      rawSnapshot: JSON.stringify({ issueType: 'Task', cinematicName: null }),
    });

    const engine = new PlanningEngine(planningData({
      disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1], cinematicJiraSyncStates: [epicState],
    }));
    const checks = coherenceChecks(engine, p1.id);
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('warning');
    expect(checks[0].cinematicId).toBe(cine.id);
    expect(checks[0].message).toContain('no Cinematics List value');
    expect(checks[0].message).toContain('Task');
  });

  it('flags a Cinematic whose bound LOQs share no Jira link with the bound epic', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id, jiraKey: 'OVR-1' });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, jiraKey: 'OVR-2' });
    const epicState = cinematicJiraSyncState({
      cinematicId: cine.id,
      rawSnapshot: JSON.stringify({ issueType: 'Initiative', cinematicName: 'CODE-A' }),
    });
    // The LOQ's own issue is neither a child of OVR-1 nor shares its Cinematics List value.
    const loqState = jiraSyncState({
      loqId: l1.id,
      rawSnapshot: JSON.stringify({ epicLinkKey: 'OTHER-9', parentKey: null, cinematicName: 'CODE-B' }),
    });

    const engine = new PlanningEngine(planningData({
      disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1],
      cinematicJiraSyncStates: [epicState], jiraSyncStates: [loqState],
    }));
    const checks = coherenceChecks(engine, p1.id);
    expect(checks).toHaveLength(1);
    expect(checks[0].severity).toBe('warning');
    expect(checks[0].message).toContain('share no Jira link');
  });

  it('stays silent when the bound LOQ is Epic-linked to the bound epic', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id, jiraKey: 'OVR-1' });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, jiraKey: 'OVR-2' });
    const epicState = cinematicJiraSyncState({
      cinematicId: cine.id,
      rawSnapshot: JSON.stringify({ issueType: 'Initiative', cinematicName: 'CODE-A' }),
    });
    const loqState = jiraSyncState({
      loqId: l1.id,
      rawSnapshot: JSON.stringify({ epicLinkKey: 'OVR-1', parentKey: null, cinematicName: 'CODE-A' }),
    });

    const engine = new PlanningEngine(planningData({
      disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1],
      cinematicJiraSyncStates: [epicState], jiraSyncStates: [loqState],
    }));
    expect(coherenceChecks(engine, p1.id)).toHaveLength(0);
  });

  it('stays silent for an unbound Cinematic (no jiraKey)', () => {
    const animation = discipline({ name: 'Animation' });
    const p1 = project({ name: 'Alpha' });
    const cine = cinematic({ projectId: p1.id, jiraKey: null });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id });

    const engine = new PlanningEngine(planningData({
      disciplines: [animation], projects: [p1], cinematics: [cine], loqs: [l1],
    }));
    expect(coherenceChecks(engine, p1.id)).toHaveLength(0);
  });
});
