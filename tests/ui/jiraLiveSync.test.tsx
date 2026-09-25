import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../../src/store/useStore';
import { seedStore } from './harness';
import { parseJiraSearchResponse, defaultJiraFieldMapping, type JiraRawSearchResponse } from '../../src/import/jiraSync';
import type { JiraProjectConfig } from '../../src/domain/types';

function seedProject() {
  return useStore.getState().createProject({
    name: 'Cinematic Alpha', status: 'planned', startDate: '2026-09-01', startCertainty: 'confirmed',
    endDate: '2026-12-31', endCertainty: 'confirmed', priority: 'medium', notes: '', isDispo: false,
  });
}

function configFor(projectId: string): JiraProjectConfig {
  return {
    projectId,
    baseUrl: 'https://jira.example.com',
    jiraProjectKey: 'OVR',
    authMode: 'server',
    email: null,
    startDateField: null,
    dueDateField: 'duedate',
    dateToleranceDays: 1,
    cinematicsListField: 'customfield_10420',
    loqTargetField: 'customfield_12338',
    epicLinkField: null,
    scopeField: null,
    scopeValue: null,
  };
}

const SAMPLE_RAW: JiraRawSearchResponse = {
  issues: [
    { key: 'OVR-1', fields: { summary: 'Seq010 Opening', issuetype: { name: 'Epic' }, status: { name: 'To Do' }, customfield_10420: { value: 'Seq010 Opening' } } },
  ],
};

afterEach(() => {
  delete (window as { jira?: unknown }).jira;
});

describe('useStore.syncJira / testJiraConnection (Phase 5b live sync)', () => {
  it('returns null and toasts without throwing when window.jira is unavailable (browser tab)', async () => {
    await seedStore();
    const project = seedProject();
    delete (window as { jira?: unknown }).jira;

    const result = await useStore.getState().syncJira(project.id);
    expect(result).toBeNull();
    expect(useStore.getState().toasts.some((t) => t.message.includes('only available in the desktop app'))).toBe(true);
  });

  it('returns null when the project has no saved Jira connection config', async () => {
    await seedStore();
    const project = seedProject();
    window.jira = {
      hasToken: async () => false,
      setToken: async () => ({ ok: true }),
      clearToken: async () => ({ ok: true }),
      search: async () => ({ ok: true, raw: { ...SAMPLE_RAW, total: 1 } }),
    };

    const result = await useStore.getState().syncJira(project.id);
    expect(result).toBeNull();
    expect(useStore.getState().toasts.some((t) => t.message.includes('No Jira connection configured'))).toBe(true);
  });

  it('produces the same NormalizedJiraBatch as the manual file-export path, fed from a stubbed window.jira.search', async () => {
    await seedStore();
    const project = seedProject();
    const config = configFor(project.id);
    useStore.getState().setJiraConfigForProject(config);

    window.jira = {
      hasToken: async () => true,
      setToken: async () => ({ ok: true }),
      clearToken: async () => ({ ok: true }),
      search: async () => ({ ok: true, raw: { ...SAMPLE_RAW, total: SAMPLE_RAW.issues!.length } }),
    };

    const result = await useStore.getState().syncJira(project.id);
    expect(result).not.toBeNull();

    const expectedBatch = parseJiraSearchResponse(SAMPLE_RAW, defaultJiraFieldMapping({
      startDateField: config.startDateField,
      dueDateField: config.dueDateField,
      cinematicsListField: config.cinematicsListField,
      loqTargetField: config.loqTargetField,
      epicLinkField: config.epicLinkField,
      scopeField: config.scopeField,
    }));
    expect(result!.batch).toEqual(expectedBatch);
    expect(result!.fileName).toBeNull();
  });

  it('toasts and returns null when window.jira.search reports a failure', async () => {
    await seedStore();
    const project = seedProject();
    useStore.getState().setJiraConfigForProject(configFor(project.id));
    window.jira = {
      hasToken: async () => true,
      setToken: async () => ({ ok: true }),
      clearToken: async () => ({ ok: true }),
      search: async () => ({ ok: false, error: 'HTTP 401 Unauthorized' }),
    };

    const result = await useStore.getState().syncJira(project.id);
    expect(result).toBeNull();
    expect(useStore.getState().toasts.some((t) => t.message.includes('HTTP 401 Unauthorized'))).toBe(true);
  });

  it('testJiraConnection reports the matched issue count without writing anything', async () => {
    await seedStore();
    const project = seedProject();
    useStore.getState().setJiraConfigForProject(configFor(project.id));
    let sawTestOnly = false;
    window.jira = {
      hasToken: async () => true,
      setToken: async () => ({ ok: true }),
      clearToken: async () => ({ ok: true }),
      search: async (args) => {
        sawTestOnly = args.testOnly === true;
        return { ok: true, raw: { ...SAMPLE_RAW, total: 7 } };
      },
    };

    const result = await useStore.getState().testJiraConnection(project.id);
    expect(result).toEqual({ ok: true, total: 7 });
    expect(sawTestOnly).toBe(true);
    expect(useStore.getState().data.cinematics).toHaveLength(0);
    expect(useStore.getState().data.loqs).toHaveLength(0);
  });

  it('testJiraConnection surfaces a config-missing error without calling window.jira', async () => {
    await seedStore();
    const project = seedProject();
    let called = false;
    window.jira = {
      hasToken: async () => false,
      setToken: async () => ({ ok: true }),
      clearToken: async () => ({ ok: true }),
      search: async () => { called = true; return { ok: true, raw: { issues: [], total: 0 } }; },
    };

    const result = await useStore.getState().testJiraConnection(project.id);
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
