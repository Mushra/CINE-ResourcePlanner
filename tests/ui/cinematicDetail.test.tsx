import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ProjectDetail } from '../../src/ui/views/ProjectDetail';
import { CinematicDetail } from '../../src/ui/views/CinematicDetail';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';

function seedProject() {
  return useStore.getState().createProject({
    name: 'Cinematic Alpha',
    status: 'planned',
    startDate: '2026-09-01',
    startCertainty: 'confirmed',
    endDate: '2026-12-31',
    endCertainty: 'confirmed',
    priority: 'medium',
    notes: '',
    isDispo: false,
  });
}

describe('ProjectDetail — Cinematics section', () => {
  it('creates a cinematic through the drawer and lists it', async () => {
    await seedStore();
    const project = seedProject();
    useUiStore.getState().openProject(project.id);
    const { user } = renderView(<ProjectDetail projectId={project.id} />);

    expect(screen.getByText('No cinematics yet. Add one to start scheduling LOQs.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New cinematic' }));
    await user.type(screen.getByLabelText('Name'), 'Seq01');
    await user.click(screen.getByRole('button', { name: 'Create cinematic' }));

    expect(await screen.findByText('Seq01')).toBeInTheDocument();
    expect(useStore.getState().data.cinematics.some((c) => c.name === 'Seq01' && c.projectId === project.id)).toBe(true);
  });

  it('drills into a cinematic and back again', async () => {
    await seedStore();
    const project = seedProject();
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: null, notes: '' });
    useUiStore.getState().openProject(project.id);
    const { user } = renderView(<ProjectDetail projectId={project.id} />);

    await user.click(screen.getByText('Seq01'));
    expect(useUiStore.getState().view).toBe('cinematic-detail');
    expect(useUiStore.getState().selectedCinematicId).toBe(cinematic.id);
    expect(useUiStore.getState().selectedProjectId).toBe(project.id);
  });

  it('edits and deletes a cinematic from the list', async () => {
    await seedStore();
    const project = seedProject();
    useStore.getState().createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: null, notes: '' });
    useUiStore.getState().openProject(project.id);
    const { user } = renderView(<ProjectDetail projectId={project.id} />);

    const row = screen.getByText('Seq01').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Seq01 Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const renamedRow = await screen.findByText('Seq01 Renamed');

    await user.click(within(renamedRow.closest('tr')!).getByRole('button', { name: 'Delete' }));
    await user.click(within(renamedRow.closest('tr')!).getByRole('button', { name: 'Confirm?' }));
    expect(screen.queryByText('Seq01 Renamed')).not.toBeInTheDocument();
    expect(useStore.getState().data.cinematics).toHaveLength(0);
  });
});

describe('CinematicDetail', () => {
  it('renders the cinematic header and returns to the project', async () => {
    await seedStore();
    const project = seedProject();
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: '2026-10-15', notes: 'Hero beat' });
    useUiStore.getState().openCinematic(cinematic.id);
    useUiStore.setState({ selectedProjectId: project.id });
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    expect(screen.getByRole('heading', { name: 'Seq01' })).toBeInTheDocument();
    expect(screen.getByText('Target: 2026-10-15')).toBeInTheDocument();
    expect(screen.getByText('Hero beat')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Back to/ }));
    expect(useUiStore.getState().view).toBe('project-detail');
    expect(useUiStore.getState().selectedProjectId).toBe(project.id);
  });

  it('deletes the cinematic through the two-step confirm', async () => {
    await seedStore();
    const project = seedProject();
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: null, notes: '' });
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm?' }));

    expect(useStore.getState().data.cinematics.some((c) => c.id === cinematic.id)).toBe(false);
    expect(useUiStore.getState().view).toBe('project-detail');
  });
});
