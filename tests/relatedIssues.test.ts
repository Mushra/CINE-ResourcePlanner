import { describe, expect, it } from 'vitest';
import { classifyRelatedIssue, relatedIssuesForCinematic, resolveRelatedIssuesByCinematic } from '../src/domain/relatedIssues';
import type { NormalizedJiraBatch, NormalizedJiraIssue } from '../src/import/jiraSync';
import type { Cinematic } from '../src/domain/types';

function issue(overrides: Partial<NormalizedJiraIssue> = {}): NormalizedJiraIssue {
  return {
    key: 'X-1', summary: 'An issue', issueType: 'Task', status: 'Open', labels: [], assignee: null,
    startDate: null, dueDate: null, resolutionDate: null, parentKey: null,
    cinematicName: null, loqTarget: null, scopeValue: null, epicLinkKey: null, updatedAt: null,
    ...overrides,
  };
}

function cinematic(id: string, name: string): Cinematic {
  return { id, projectId: 'p1', name, jiraKey: null, targetDate: null, notes: '', sortOrder: 0 };
}

const HOTLINE = 'CINE_HOTLINE';

describe('classifyRelatedIssue', () => {
  it('classifies a hotline by its label (case-insensitive)', () => {
    expect(classifyRelatedIssue(issue({ labels: ['cine_hotline'] }), HOTLINE)).toBe('hotline');
    expect(classifyRelatedIssue(issue({ labels: ['other', 'CINE_HOTLINE'] }), HOTLINE)).toBe('hotline');
  });

  it('classifies a bug by its issue type', () => {
    expect(classifyRelatedIssue(issue({ issueType: 'Bug' }), HOTLINE)).toBe('bug');
    expect(classifyRelatedIssue(issue({ issueType: 'bug' }), HOTLINE)).toBe('bug');
  });

  it('prefers hotline when an issue is both a labelled Bug', () => {
    expect(classifyRelatedIssue(issue({ issueType: 'Bug', labels: [HOTLINE] }), HOTLINE)).toBe('hotline');
  });

  it('returns null for anything that is neither', () => {
    expect(classifyRelatedIssue(issue({ issueType: 'Story' }), HOTLINE)).toBeNull();
    expect(classifyRelatedIssue(issue({ issueType: 'Task', labels: ['unrelated'] }), HOTLINE)).toBeNull();
  });
});

describe('resolveRelatedIssuesByCinematic', () => {
  const cinematics = [cinematic('c1', 'Seq010 Opening'), cinematic('c2', 'Seq020 Chase')];

  it('associates via the issue\'s own Cinematics List name, accent/order-insensitively', () => {
    const batch: NormalizedJiraBatch = {
      issues: [
        issue({ key: 'A-1', issueType: 'Bug', cinematicName: 'Opening Seq010' }), // reordered tokens
        issue({ key: 'A-2', labels: [HOTLINE], cinematicName: 'Seq020 Chase' }),
      ],
      warnings: [],
    };
    const map = resolveRelatedIssuesByCinematic(batch, cinematics, HOTLINE, '2026-09-28T00:00:00Z');
    expect(map.get('c1')!.map((r) => r.jiraKey)).toEqual(['A-1']);
    expect(map.get('c2')!.map((r) => r.jiraKey)).toEqual(['A-2']);
    expect(map.get('c1')![0]).toMatchObject({ kind: 'bug', lastSyncedAt: '2026-09-28T00:00:00Z' });
  });

  it('anchors on the bound issue\'s Cinematics List value when the app name does not match it', () => {
    // Real-project shape: the Cinematics List value is a technical code the Cinematic name never
    // equals, so name matching alone would drop everything. The Cinematic is bound to an Initiative
    // (INIT-9) that carries the same code its bug/hotline do.
    const bound = { ...cinematic('c1', 'Seq010 Opening'), jiraKey: 'INIT-9' };
    const code = 'SOLO_MQ1020_S000_CIN Fixers_Car';
    const batch: NormalizedJiraBatch = {
      issues: [
        issue({ key: 'INIT-9', issueType: 'Initiative', cinematicName: code }), // the bound issue
        issue({ key: 'B-1', issueType: 'Bug', cinematicName: code }),
        issue({ key: 'H-1', labels: [HOTLINE], cinematicName: code }),
      ],
      warnings: [],
    };
    const map = resolveRelatedIssuesByCinematic(batch, [bound], HOTLINE, 't');
    // The Initiative itself is not a related issue (neither a Bug nor hotline-labelled).
    expect(map.get('c1')!.map((r) => r.jiraKey).sort()).toEqual(['B-1', 'H-1']);
  });

  it('resolves a sub-task hotline that lacks the field through its parent in the batch', () => {
    const batch: NormalizedJiraBatch = {
      issues: [
        issue({ key: 'P-1', issueType: 'Task', cinematicName: 'Seq010 Opening' }),
        issue({ key: 'P-2', issueType: 'Sub-task', labels: [HOTLINE], parentKey: 'P-1', cinematicName: null }),
      ],
      warnings: [],
    };
    const map = resolveRelatedIssuesByCinematic(batch, cinematics, HOTLINE, 't');
    expect(map.get('c1')!.map((r) => r.jiraKey)).toEqual(['P-2']);
  });

  it('drops issues matching no cinematic and non-related issues', () => {
    const batch: NormalizedJiraBatch = {
      issues: [
        issue({ key: 'D-1', issueType: 'Bug', cinematicName: 'Unknown Seq' }),
        issue({ key: 'D-2', issueType: 'Story', cinematicName: 'Seq010 Opening' }),
      ],
      warnings: [],
    };
    const map = resolveRelatedIssuesByCinematic(batch, cinematics, HOTLINE, 't');
    expect(map.size).toBe(0);
  });
});

describe('relatedIssuesForCinematic', () => {
  it('assigns every classified issue to the given cinematic, skipping name/parent resolution', () => {
    const batch: NormalizedJiraBatch = {
      issues: [
        issue({ key: 'L-1', labels: [HOTLINE], cinematicName: null, parentKey: 'MISSING' }), // parent not in batch
        issue({ key: 'L-2', issueType: 'Bug', cinematicName: null }),
        issue({ key: 'L-3', issueType: 'Story' }), // not related
      ],
      warnings: [],
    };
    const rows = relatedIssuesForCinematic(batch, 'c1', HOTLINE, 't');
    expect(rows.map((r) => r.jiraKey)).toEqual(['L-1', 'L-2']);
    expect(rows.every((r) => r.cinematicId === 'c1')).toBe(true);
    expect(rows.find((r) => r.jiraKey === 'L-1')!.kind).toBe('hotline');
  });
});
