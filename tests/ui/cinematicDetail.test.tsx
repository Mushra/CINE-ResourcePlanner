import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
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
    useUiStore.getState().setProjectView('production');
    useUiStore.getState().setProductionScreen('matrix'); // the cinematics list lives on the Matrix screen
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
    useUiStore.getState().setProjectView('production');
    useUiStore.getState().setProductionScreen('matrix');
    const { user } = renderView(<ProjectDetail projectId={project.id} />);

    await user.click(screen.getByText('Seq01'));
    expect(useUiStore.getState().view).toBe('cinematic-detail');
    expect(useUiStore.getState().selectedCinematicId).toBe(cinematic.id);
    expect(useUiStore.getState().selectedProjectId).toBe(project.id);
  });

  it('edits and deletes a cinematic via the matrix drill-in and Cinematic Detail', async () => {
    // The Cinematics Matrix deliberately has no per-row Edit/Delete (dropped in the Watchtower
    // rework — CinematicDetail's own header already exposes both, so nothing is lost, only
    // relocated to the drill-in screen). Clicking the row's name is still how you get there.
    await seedStore();
    const project = seedProject();
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: null, notes: '' });
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('production');
    useUiStore.getState().setProductionScreen('matrix');
    const { user, unmount } = renderView(<ProjectDetail projectId={project.id} />);

    await user.click(screen.getByText('Seq01'));
    expect(useUiStore.getState().view).toBe('cinematic-detail');
    unmount(); // swap "screens" for real — the app shell would unmount ProjectDetail here too

    const { user: detailUser } = renderView(<CinematicDetail cinematicId={cinematic.id} />);
    await detailUser.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByLabelText('Name');
    await detailUser.clear(nameInput);
    await detailUser.type(nameInput, 'Seq01 Renamed');
    await detailUser.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Seq01 Renamed' })).toBeInTheDocument();

    await detailUser.click(screen.getByRole('button', { name: 'Delete' }));
    await detailUser.click(screen.getByRole('button', { name: 'Confirm?' }));
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
