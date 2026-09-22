import { describe, expect, it } from 'vitest';
import { jiraMatchKey, suggestJiraBindings } from '../src/domain/jiraBinding';
import { cinematic, discipline, loq } from './fixtures';
import type { NormalizedJiraBatch, NormalizedJiraIssue } from '../src/import/jiraSync';

function issue(overrides: Partial<NormalizedJiraIssue> = {}): NormalizedJiraIssue {
  return {
    key: 'PROD-1',
    summary: '',
    issueType: 'Task',
    status: 'To Do',
    assignee: null,
    startDate: null,
    dueDate: null,
    resolutionDate: null,
    parentKey: null,
    cinematicName: null,
    loqTarget: null,
    scopeValue: null,
    epicLinkKey: null,
    updatedAt: null,
    ...overrides,
  };
}

function batch(issues: NormalizedJiraIssue[]): NormalizedJiraBatch {
  return { issues, warnings: [] };
}

describe('jiraMatchKey', () => {
  it('is insensitive to accents, case, and token order', () => {
    expect(jiraMatchKey('Séquence Ouverture')).toBe(jiraMatchKey('ouverture sequence'));
  });
});

describe('suggestJiraBindings — Cinematics', () => {
  it('trusts a pre-existing jiraKey without scoring, when it exists in the batch', () => {
    const cine = cinematic({ name: 'Totally different name', jiraKey: 'PROD-100' });
    const epic = issue({ key: 'PROD-100', summary: 'Opening sequence' });

    const proposals = suggestJiraBindings([cine], [], [], batch([epic]));
    expect(proposals.cinematics).toEqual([{ via: 'exact-key', cinematicId: cine.id, proposedKey: 'PROD-100', score: null }]);
  });

  it('prefers the Cinematics List field over name similarity — the strongest signal', () => {
    const cine = cinematic({ name: 'SOLO_MQ1020_S000_CIN Fixers_Car' });
    // A decoy with better name overlap but no field match, and the real match via the field only.
    const decoy = issue({ key: 'PROD-200', summary: 'SOLO_MQ1020_S000_CIN Fixers_Car - unrelated task' });
    const fieldMatch = issue({ key: 'PROD-300', summary: 'Some Initiative', cinematicName: 'SOLO_MQ1020_S000_CIN Fixers_Car' });

    const proposals = suggestJiraBindings([cine], [], [], batch([decoy, fieldMatch]));
    expect(proposals.cinematics).toEqual([{ via: 'cinematics-field', cinematicId: cine.id, proposedKey: 'PROD-300', score: expect.any(Number) }]);
  });

  it('falls back to name-similarity when no issue carries a matching Cinematics List value', () => {
    const cine = cinematic({ name: 'Seq010 Opening' });
    const epic1 = issue({ key: 'PROD-100', summary: 'Seq010 - Opening sequence' });
    const epic2 = issue({ key: 'PROD-200', summary: 'Completely unrelated epic' });

    const proposals = suggestJiraBindings([cine], [], [], batch([epic1, epic2]));
    expect(proposals.cinematics).toHaveLength(1);
    expect(proposals.cinematics[0].via).toBe('name');
    expect(proposals.cinematics[0].proposedKey).toBe('PROD-100');
    expect(proposals.cinematics[0].score).toBeGreaterThanOrEqual(0.5);
  });

  it('leaves an ambiguous/low-similarity Cinematic unmatched for manual choice', () => {
    const cine = cinematic({ name: 'Seq010 Opening' });
    const epic = issue({ key: 'PROD-900', summary: 'Something else entirely' });

    const proposals = suggestJiraBindings([cine], [], [], batch([epic]));
    expect(proposals.cinematics).toEqual([{ via: 'unmatched', cinematicId: cine.id, proposedKey: null, score: 0 }]);
  });

  it('has no proposals when the batch is empty', () => {
    const cine = cinematic({ name: 'Seq010 Opening' });
    const proposals = suggestJiraBindings([cine], [], [], batch([]));
    expect(proposals.cinematics).toEqual([{ via: 'unmatched', cinematicId: cine.id, proposedKey: null, score: null }]);
  });

  it('excludes out-of-scope issues before running the cascade (e.g. "CIN 1" when scoped to "CIN 2")', () => {
    const cine = cinematic({ name: 'SOLO_MQ1020_S000_CIN Fixers_Car' });
    const otherDept = issue({ key: 'NEO-1', summary: 'Initiative', cinematicName: 'SOLO_MQ1020_S000_CIN Fixers_Car', scopeValue: 'CIN 1' });
    const ownDept = issue({ key: 'NEO-2', summary: 'Initiative', cinematicName: 'SOLO_MQ1020_S000_CIN Fixers_Car', scopeValue: 'CIN 2' });

    const scoped = suggestJiraBindings([cine], [], [], batch([otherDept, ownDept]), { scopeValue: 'CIN 2' });
    expect(scoped.cinematics).toEqual([{ via: 'cinematics-field', cinematicId: cine.id, proposedKey: 'NEO-2', score: expect.any(Number) }]);

    // With no scope filter, the CIN 1 candidate is a legitimate field-match candidate too — either
    // could be picked (both carry the same cinematicName); what matters is that scoping actually
    // changes which candidates are considered.
    const unscoped = suggestJiraBindings([cine], [], [], batch([otherDept]), {});
    expect(unscoped.cinematics[0].via).toBe('cinematics-field');
    expect(unscoped.cinematics[0].proposedKey).toBe('NEO-1');
  });

  it('never applies the scope filter to an explicit exact-key binding', () => {
    const cine = cinematic({ name: 'Anything', jiraKey: 'NEO-1' });
    const otherDept = issue({ key: 'NEO-1', summary: 'Initiative', scopeValue: 'CIN 1' });

    const proposals = suggestJiraBindings([cine], [], [], batch([otherDept]), { scopeValue: 'CIN 2' });
    expect(proposals.cinematics).toEqual([{ via: 'exact-key', cinematicId: cine.id, proposedKey: 'NEO-1', score: null }]);
  });
});

describe('suggestJiraBindings — LOQs', () => {
  it('prefers the Cinematics List + LOQ Target fields over any parent/epic relationship', () => {
    const animation = discipline({ name: 'Animation' });
    const cine = cinematic({ name: 'Seq010 Opening' });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L1' });

    const cineIssue = issue({ key: 'PROD-100', summary: 'Seq010 Opening', cinematicName: 'Seq010 Opening' });
    const fieldMatch = issue({
      key: 'PROD-101', summary: 'AudioPass-L1', cinematicName: 'Seq010 Opening', loqTarget: 'L1',
    });

    const proposals = suggestJiraBindings([cine], [l1], [animation], batch([cineIssue, fieldMatch]));
    expect(proposals.loqs).toEqual([{ via: 'cinematics-field', loqId: l1.id, proposedKey: 'PROD-101', score: expect.any(Number) }]);
  });

  it('falls back to the Epic Link/Parent Issue relationship when no field match exists', () => {
    const animation = discipline({ name: 'Animation' });
    const cine = cinematic({ name: 'Seq010 Opening' });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L1' });

    const epic = issue({ key: 'PROD-100', summary: 'Seq010 Opening' });
    const childIssue = issue({ key: 'PROD-101', summary: 'Animation L1', parentKey: 'PROD-100' });
    const decoyOutsideEpic = issue({ key: 'PROD-999', summary: 'Animation L1', parentKey: 'PROD-777' });

    const proposals = suggestJiraBindings([cine], [l1], [animation], batch([epic, childIssue, decoyOutsideEpic]));
    expect(proposals.loqs).toEqual([{ via: 'epic-link', loqId: l1.id, proposedKey: 'PROD-101', score: expect.any(Number) }]);
  });

  it('falls back to the Epic Link relationship via a dedicated Epic Link field, not just native parent', () => {
    const animation = discipline({ name: 'Animation' });
    const cine = cinematic({ name: 'Seq010 Opening' });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L1' });

    const epic = issue({ key: 'NEO-100', summary: 'Seq010 Opening' });
    const childViaEpicLink = issue({ key: 'NEO-101', summary: 'Animation L1', epicLinkKey: 'NEO-100' });

    const proposals = suggestJiraBindings([cine], [l1], [animation], batch([epic, childViaEpicLink]));
    expect(proposals.loqs).toEqual([{ via: 'epic-link', loqId: l1.id, proposedKey: 'NEO-101', score: expect.any(Number) }]);
  });

  it('trusts an exact pre-existing jiraKey on a LOQ without needing its Cinematic matched first', () => {
    const cine = cinematic({ name: 'Unrelated name' });
    const l1 = loq({ cinematicId: cine.id, jiraKey: 'PROD-101' });
    const childIssue = issue({ key: 'PROD-101', summary: 'Anything' });

    const proposals = suggestJiraBindings([cine], [l1], [], batch([childIssue]));
    expect(proposals.loqs).toEqual([{ via: 'exact-key', loqId: l1.id, proposedKey: 'PROD-101', score: null }]);
  });

  it('falls back to name-similarity over the whole (scoped) batch when neither field nor link match', () => {
    const animation = discipline({ name: 'Animation' });
    const cine = cinematic({ name: 'Seq010 Opening' });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L1' });
    const unrelatedEpic = issue({ key: 'PROD-900', summary: 'Something else entirely' });
    const nameMatch = issue({ key: 'PROD-950', summary: 'Animation L1' });

    const proposals = suggestJiraBindings([cine], [l1], [animation], batch([unrelatedEpic, nameMatch]));
    expect(proposals.loqs).toEqual([{ via: 'name', loqId: l1.id, proposedKey: 'PROD-950', score: expect.any(Number) }]);
  });

  it('leaves a LOQ unmatched when nothing clears the name-similarity threshold and there is no field/link signal', () => {
    const animation = discipline({ name: 'Animation' });
    const cine = cinematic({ name: 'Seq010 Opening' });
    const l1 = loq({ cinematicId: cine.id, disciplineId: animation.id, type: 'L1' });
    const unrelatedEpic = issue({ key: 'PROD-900', summary: 'Something else entirely' });

    const proposals = suggestJiraBindings([cine], [l1], [animation], batch([unrelatedEpic]));
    expect(proposals.loqs).toEqual([{ via: 'unmatched', loqId: l1.id, proposedKey: null, score: 0 }]);
  });
});
