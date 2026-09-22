import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ProjectDetail } from '../../src/ui/views/ProjectDetail';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';
import * as files from '../../src/persistence/files';
import type { JiraRawSearchResponse } from '../../src/import/jiraSync';

vi.mock('../../src/persistence/files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/persistence/files')>();
  return { ...actual, openJsonFile: vi.fn() };
});

function mockExport(raw: JiraRawSearchResponse, name = 'jira-export.json'): void {
  vi.mocked(files.openJsonFile).mockResolvedValue({ text: JSON.stringify(raw), name });
}

function seedProject() {
  return useStore.getState().createProject({
    name: 'Cinematic Alpha', status: 'planned', startDate: '2026-09-01', startCertainty: 'confirmed',
    endDate: '2026-12-31', endCertainty: 'confirmed', priority: 'medium', notes: '', isDispo: false,
  });
}

describe('JiraBindingDrawer (via ProjectDetail)', () => {
  it('proposes a heuristic match for an unmatched Cinematic, then links only within the target project', async () => {
    await seedStore();
    const otherProject = seedProject();
    const project = seedProject();
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Exodus Intro', jiraKey: null, targetDate: null, notes: '' });
    useUiStore.getState().openProject(project.id);

    mockExport({ issues: [{ key: 'OVR-1', fields: { summary: 'Exodus Intro', issuetype: { name: 'Epic' }, status: { name: 'To Do' } } }] });

    const { user } = renderView(<ProjectDetail projectId={project.id} />);
    await user.click(screen.getByRole('button', { name: 'Sync with Jira' }));
    await user.click(screen.getByRole('button', { name: 'Choose Jira export…' }));

    expect(await screen.findByText('Exodus Intro', { selector: '.jira-binding-name' })).toBeInTheDocument();
    expect(screen.getByText('OVR-1 — Exodus Intro', { selector: 'option' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply bindings' }));

    expect(await screen.findByText(/1 cinematic.*linked/)).toBeInTheDocument();

    const data = useStore.getState().data;
    expect(data.cinematics.find((c) => c.id === cinematic.id)?.jiraKey).toBe('OVR-1');
    expect(data.cinematics.some((c) => c.projectId === otherProject.id && c.jiraKey)).toBe(false);
  });

  it('skips the mapping step and applies immediately when every proposal is an exact key match', async () => {
    await seedStore();
    const project = seedProject();
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Exodus Intro', jiraKey: 'OVR-1', targetDate: null, notes: '' });
    useUiStore.getState().openProject(project.id);

    mockExport({ issues: [{ key: 'OVR-1', fields: { summary: 'Something unrelated', issuetype: { name: 'Epic' }, status: { name: 'Done' } } }] });

    const { user } = renderView(<ProjectDetail projectId={project.id} />);
    await user.click(screen.getByRole('button', { name: 'Sync with Jira' }));
    await user.click(screen.getByRole('button', { name: 'Choose Jira export…' }));

    expect(await screen.findByText(/1 cinematic.*linked/)).toBeInTheDocument();
    expect(screen.queryByText('Exodus Intro', { selector: '.jira-binding-name' })).not.toBeInTheDocument();

    const data = useStore.getState().data;
    expect(data.cinematics.find((c) => c.id === cinematic.id)?.jiraKey).toBe('OVR-1');
  });

  it('shows the Cinematics List signal badge for a field-based match, and lets the user override it', async () => {
    await seedStore();
    const project = seedProject();
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Seq010 Opening', jiraKey: null, targetDate: null, notes: '' });
    useUiStore.getState().openProject(project.id);

    // The decoy has better name overlap but no Cinematics List value; the real match carries the
    // field (customfield_10420) instead — the cascade should prefer the field over name-similarity.
    mockExport({
      issues: [
        { key: 'OVR-1', fields: { summary: 'Seq010 Opening - unrelated decoy', issuetype: { name: 'Epic' }, status: { name: 'To Do' } } },
        {
          key: 'OVR-2',
          fields: { summary: 'Some Initiative', issuetype: { name: 'Initiative' }, status: { name: 'To Do' }, customfield_10420: { value: 'Seq010 Opening' } },
        },
      ],
    });

    const { user } = renderView(<ProjectDetail projectId={project.id} />);
    await user.click(screen.getByRole('button', { name: 'Sync with Jira' }));
    await user.click(screen.getByRole('button', { name: 'Choose Jira export…' }));

    await screen.findByText('Seq010 Opening', { selector: '.jira-binding-name' });
    expect(screen.getByText('via Cinematics List')).toBeInTheDocument();

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('OVR-2');

    // Override the proposed field match with the decoy.
    await user.selectOptions(select, 'OVR-1');
    await user.click(screen.getByRole('button', { name: 'Apply bindings' }));

    expect(await screen.findByText(/1 cinematic.*linked/)).toBeInTheDocument();
    const data = useStore.getState().data;
    expect(data.cinematics.find((c) => c.id === cinematic.id)?.jiraKey).toBe('OVR-1');
  });
});
