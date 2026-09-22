import { describe, expect, it } from 'vitest';
import { parseJiraSearchResponse, type JiraFieldMapping, type JiraRawSearchResponse } from '../src/import/jiraSync';

const NATIVE_ONLY: JiraFieldMapping = {
  startDateField: null, dueDateField: null, cinematicsListField: null, loqTargetField: null, epicLinkField: null, scopeField: null,
};
const WITH_CUSTOM_START: JiraFieldMapping = { ...NATIVE_ONLY, startDateField: 'customfield_10015' };
const WITH_ALL_FIELDS: JiraFieldMapping = {
  ...NATIVE_ONLY,
  cinematicsListField: 'customfield_10420',
  loqTargetField: 'customfield_12338',
  epicLinkField: 'customfield_10101',
  scopeField: 'customfield_57706',
};

describe('parseJiraSearchResponse', () => {
  it('parses a realistic REST search response into normalized issues', () => {
    const raw: JiraRawSearchResponse = {
      issues: [
        {
          key: 'PROD-100',
          fields: {
            summary: 'Opening sequence',
            issuetype: { name: 'Epic' },
            status: { name: 'In Progress' },
            assignee: { displayName: 'Alice Martin' },
            duedate: '2026-12-15',
            resolutiondate: null,
            parent: null,
            updated: '2026-09-20T10:23:00.000+0000',
          },
        },
        {
          key: 'PROD-101',
          fields: {
            summary: 'Animation L1',
            issuetype: { name: 'Task' },
            status: { name: 'Done' },
            assignee: null,
            duedate: '2026-10-01',
            resolutiondate: '2026-09-28T08:00:00.000+0000',
            parent: { key: 'PROD-100' },
            updated: '2026-09-28T08:00:00.000+0000',
          },
        },
      ],
    };

    const batch = parseJiraSearchResponse(raw, NATIVE_ONLY);
    expect(batch.warnings).toHaveLength(0);
    expect(batch.issues).toEqual([
      {
        key: 'PROD-100',
        summary: 'Opening sequence',
        issueType: 'Epic',
        status: 'In Progress',
        assignee: 'Alice Martin',
        startDate: null,
        dueDate: '2026-12-15',
        resolutionDate: null,
        parentKey: null,
        cinematicName: null,
        loqTarget: null,
        scopeValue: null,
        epicLinkKey: null,
        updatedAt: '2026-09-20T10:23:00.000+0000',
      },
      {
        key: 'PROD-101',
        summary: 'Animation L1',
        issueType: 'Task',
        status: 'Done',
        assignee: null,
        startDate: null,
        dueDate: '2026-10-01',
        resolutionDate: '2026-09-28',
        parentKey: 'PROD-100',
        cinematicName: null,
        loqTarget: null,
        scopeValue: null,
        epicLinkKey: null,
        updatedAt: '2026-09-28T08:00:00.000+0000',
      },
    ]);
  });

  it('reads the Cinematics List/LOQ Target/scope/Epic Link picklist fields, defensively unwrapping {value} objects', () => {
    const raw: JiraRawSearchResponse = {
      issues: [
        {
          key: 'OVR-1',
          fields: {
            summary: 'SOLO_MQ1020_S000_CIN Fixers_Car-Animation-L1',
            customfield_10420: { value: 'SOLO_MQ1020_S000_CIN Fixers_Car' },
            customfield_12338: { value: 'L1' },
            customfield_57706: { value: 'CIN 2' },
            customfield_10101: 'PROD-100', // a plain string, as some Epic Link renderings return
          },
        },
        {
          // Confirmed real case: AudioPass-L1/L2 and NEO's Scene/Scene Task issues lack the
          // Cinematics List field entirely — must read as null, never throw.
          key: 'OVR-2',
          fields: { summary: 'AudioPass-L1' },
        },
      ],
    };
    const batch = parseJiraSearchResponse(raw, WITH_ALL_FIELDS);
    expect(batch.issues[0]).toMatchObject({
      cinematicName: 'SOLO_MQ1020_S000_CIN Fixers_Car',
      loqTarget: 'L1',
      scopeValue: 'CIN 2',
      epicLinkKey: 'PROD-100',
    });
    expect(batch.issues[1]).toMatchObject({
      cinematicName: null,
      loqTarget: null,
      scopeValue: null,
      epicLinkKey: null,
    });
  });

  it('reads the start date from the configured custom field, falling back to null when unmapped', () => {
    const rawWithCustom: JiraRawSearchResponse = {
      issues: [{ key: 'PROD-1', fields: { summary: 'A', customfield_10015: '2026-08-01', duedate: '2026-08-15' } }],
    };
    const withMapping = parseJiraSearchResponse(rawWithCustom, WITH_CUSTOM_START);
    expect(withMapping.issues[0].startDate).toBe('2026-08-01');

    const withoutMapping = parseJiraSearchResponse(rawWithCustom, NATIVE_ONLY);
    expect(withoutMapping.issues[0].startDate).toBeNull();
  });

  it('skips issues with no key and warns', () => {
    const raw: JiraRawSearchResponse = { issues: [{ fields: { summary: 'orphan' } }, { key: 'PROD-2', fields: { summary: 'ok' } }] };
    const batch = parseJiraSearchResponse(raw, NATIVE_ONLY);
    expect(batch.issues).toHaveLength(1);
    expect(batch.issues[0].key).toBe('PROD-2');
    expect(batch.warnings).toHaveLength(1);
  });

  it('defaults missing fields to sensible empty values instead of throwing', () => {
    const raw: JiraRawSearchResponse = { issues: [{ key: 'PROD-3' }] };
    const batch = parseJiraSearchResponse(raw, NATIVE_ONLY);
    expect(batch.issues[0]).toMatchObject({
      key: 'PROD-3',
      summary: '',
      issueType: 'Unknown',
      status: 'Unknown',
      assignee: null,
      startDate: null,
      dueDate: null,
      resolutionDate: null,
      parentKey: null,
      updatedAt: null,
    });
  });

  it('handles an empty/absent issues array', () => {
    expect(parseJiraSearchResponse({}, NATIVE_ONLY)).toEqual({ issues: [], warnings: [] });
  });
});
