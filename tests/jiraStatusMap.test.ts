import { describe, expect, it } from 'vitest';
import {
  CANONICAL_STATUSES,
  DEFAULT_JIRA_STATUS_MAPPING,
  UNMAPPED,
  bugStatusBucket,
  resolveJiraStatus,
  withJiraConfigDefaults,
} from '../src/domain/jiraStatusMap';
import { jiraConfig } from './fixtures';

describe('resolveJiraStatus', () => {
  it('resolves common Jira statuses through the default map', () => {
    expect(resolveJiraStatus('To Do', DEFAULT_JIRA_STATUS_MAPPING)).toBe('TODO');
    expect(resolveJiraStatus('In Progress', DEFAULT_JIRA_STATUS_MAPPING)).toBe('IN_PROGRESS');
    expect(resolveJiraStatus('In Review', DEFAULT_JIRA_STATUS_MAPPING)).toBe('TO_REVIEW');
    expect(resolveJiraStatus('Blocked', DEFAULT_JIRA_STATUS_MAPPING)).toBe('BLOCKED');
    expect(resolveJiraStatus('Done', DEFAULT_JIRA_STATUS_MAPPING)).toBe('DONE');
    expect(resolveJiraStatus('Cancelled', DEFAULT_JIRA_STATUS_MAPPING)).toBe('CUT');
  });

  it('matches case-insensitively and trims whitespace', () => {
    expect(resolveJiraStatus('  in PROGRESS  ', DEFAULT_JIRA_STATUS_MAPPING)).toBe('IN_PROGRESS');
    expect(resolveJiraStatus('DONE', DEFAULT_JIRA_STATUS_MAPPING)).toBe('DONE');
  });

  it('returns null (never a default) for an uncovered or empty status', () => {
    expect(resolveJiraStatus('Some Custom State', DEFAULT_JIRA_STATUS_MAPPING)).toBeNull();
    expect(resolveJiraStatus(null, DEFAULT_JIRA_STATUS_MAPPING)).toBeNull();
    expect(resolveJiraStatus('', DEFAULT_JIRA_STATUS_MAPPING)).toBeNull();
  });

  it('falls back to the built-in default map when the supplied mapping is null or empty', () => {
    expect(resolveJiraStatus('In Progress', null)).toBe('IN_PROGRESS');
    expect(resolveJiraStatus('In Progress', {})).toBe('IN_PROGRESS');
  });

  it('honours a custom mapping over the default vocabulary', () => {
    expect(resolveJiraStatus('Parked', { parked: 'BLOCKED' })).toBe('BLOCKED');
    // A custom, non-empty map does NOT silently inherit default keys.
    expect(resolveJiraStatus('In Progress', { parked: 'BLOCKED' })).toBeNull();
  });

  it('only ever targets canonical statuses (never `paused`)', () => {
    for (const target of Object.values(DEFAULT_JIRA_STATUS_MAPPING)) {
      expect(CANONICAL_STATUSES).toContain(target);
    }
  });
});

describe('withJiraConfigDefaults', () => {
  it('backfills the default status mapping onto a config that predates the field', () => {
    const legacy = { ...jiraConfig({ projectId: 'p1' }), statusMapping: null };
    const filled = withJiraConfigDefaults(legacy);
    expect(filled.statusMapping).toEqual(DEFAULT_JIRA_STATUS_MAPPING);
  });

  it('leaves a config that already has a populated mapping untouched', () => {
    const custom = jiraConfig({ projectId: 'p1', statusMapping: { open: 'TODO' } });
    expect(withJiraConfigDefaults(custom)).toBe(custom);
  });
});

describe('UNMAPPED sentinel', () => {
  it('is the string "unmapped"', () => {
    expect(UNMAPPED).toBe('unmapped');
  });
});

describe('bugStatusBucket', () => {
  const mapping = DEFAULT_JIRA_STATUS_MAPPING;

  it('buckets each canonical status into a QA-bug metric', () => {
    expect(bugStatusBucket('Open', null, mapping)).toBe('open');
    expect(bugStatusBucket('In Progress', null, mapping)).toBe('inProgress');
    expect(bugStatusBucket('In Review', null, mapping)).toBe('inProgress'); // TO_REVIEW folds into In Progress
    expect(bugStatusBucket('Waiting For', null, mapping)).toBe('waitingFor'); // BLOCKED family
    expect(bugStatusBucket('On Hold', null, mapping)).toBe('waitingFor');
    expect(bugStatusBucket('Done', null, mapping)).toBe('resolved');
    expect(bugStatusBucket("Won't Do", null, mapping)).toBe('resolved'); // CUT counts as resolved/closed
  });

  it('treats a resolution date as Resolved regardless of the raw status', () => {
    expect(bugStatusBucket('In Progress', '2026-09-20', mapping)).toBe('resolved');
    expect(bugStatusBucket(null, '2026-09-20', mapping)).toBe('resolved');
  });

  it('counts an unmapped or missing status as Open rather than dropping it', () => {
    expect(bugStatusBucket('Some Custom Status', null, mapping)).toBe('open');
    expect(bugStatusBucket(null, null, mapping)).toBe('open');
  });
});
