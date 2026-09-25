import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ProjectDetail } from '../../src/ui/views/ProjectDetail';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';
import type { MppShimOutput } from '../../src/types/mpp';

function fixtureJson(): MppShimOutput {
  return {
    totalNonSummaryTasks: 1,
    tasks: [
      {
        uid: 1,
        name: 'Exodus Intro-Anim-L0',
        cinematicName: 'Exodus Intro',
        discipline: 'ANIM',
        loqType: 'L0',
        jiraKey: 'OVR-1',
        start: '2025-01-06',
        finish: '2025-01-20',
        durationDays: 10,
        workHours: 80,
        predecessors: [],
        resources: [{ name: 'Antony Cartot', group: 'ANIM', start: '2025-01-06', finish: '2025-01-20', units: 100 }],
      },
    ],
    resourceRoster: [{ name: 'Antony Cartot', group: 'ANIM' }],
  };
}

function seedProject() {
  return useStore.getState().createProject({
    name: 'Cinematic Alpha', status: 'planned', startDate: '2026-09-01', startCertainty: 'confirmed',
    endDate: '2026-12-31', endCertainty: 'confirmed', priority: 'medium', notes: '', isDispo: false,
  });
}

afterEach(() => {
  delete (window as { mpp?: unknown }).mpp;
});

describe('MppImportDrawer (via ProjectDetail)', () => {
  it('shows a discipline mapping step for an unmatched code, then imports into the target project only', async () => {
    await seedStore();
    const otherProject = seedProject();
    const project = seedProject();
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('production');
    useUiStore.getState().setProductionScreen('matrix'); // Import .mpp lives on the Cinematics Matrix screen
    window.mpp = { pickAndParse: async () => ({ canceled: false, fileName: 'sample.mpp', json: fixtureJson() }) };

    const { user } = renderView(<ProjectDetail projectId={project.id} />);
    await user.click(screen.getByRole('button', { name: 'Import .mpp' }));
    await user.click(screen.getByRole('button', { name: 'Choose file…' }));

    // Unmatched "ANIM" code surfaces the mapping step, pre-filled to create a new discipline.
    expect(await screen.findByText('ANIM')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText(/1 LOQ.*created/)).toBeInTheDocument();

    const data = useStore.getState().data;
    expect(data.disciplines.map((d) => d.name)).toEqual(['ANIM']);
    const cinematic = data.cinematics.find((c) => c.projectId === project.id);
    expect(cinematic?.name).toBe('Exodus Intro');
    expect(data.loqs.some((l) => l.jiraKey === 'OVR-1' && l.cinematicId === cinematic?.id)).toBe(true);
    expect(data.people.map((p) => p.name)).toEqual(['Antony Cartot']);
    // The other project gained nothing.
    expect(data.cinematics.some((c) => c.projectId === otherProject.id)).toBe(false);
  });

  it('skips the mapping step and imports immediately when every code auto-matches by name', async () => {
    await seedStore();
    const project = seedProject();
    useStore.getState().createDiscipline({ name: 'ANIM', color: '#4f7cff' });
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('production');
    useUiStore.getState().setProductionScreen('matrix');
    window.mpp = { pickAndParse: async () => ({ canceled: false, fileName: 'sample.mpp', json: fixtureJson() }) };

    const { user } = renderView(<ProjectDetail projectId={project.id} />);
    await user.click(screen.getByRole('button', { name: 'Import .mpp' }));
    await user.click(screen.getByRole('button', { name: 'Choose file…' }));

    expect(await screen.findByText(/1 LOQ.*created/)).toBeInTheDocument();
    expect(screen.queryByText('ANIM', { selector: '.mpp-mapping-code' })).not.toBeInTheDocument();

    const data = useStore.getState().data;
    expect(data.disciplines).toHaveLength(1); // matched the pre-existing one, didn't create a second
  });

  it('reports an error toast and does not open the picker when window.mpp is unavailable', async () => {
    await seedStore();
    const project = seedProject();
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('production');
    useUiStore.getState().setProductionScreen('matrix');
    delete (window as { mpp?: unknown }).mpp;

    const { user } = renderView(<ProjectDetail projectId={project.id} />);
    await user.click(screen.getByRole('button', { name: 'Import .mpp' }));
    await user.click(screen.getByRole('button', { name: 'Choose file…' }));

    // Toasts render outside ProjectDetail (see Toaster.tsx) — assert on the store's toast queue.
    await vi.waitFor(() => {
      expect(useStore.getState().toasts.some((t) => t.message.includes('only available in the desktop app'))).toBe(true);
    });
    // The drawer stays on the "choose file" step rather than advancing.
    expect(screen.getByRole('button', { name: 'Choose file…' })).toBeInTheDocument();
  });
});
