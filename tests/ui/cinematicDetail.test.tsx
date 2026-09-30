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

describe('CinematicDetail — LOQ discovery', () => {
  it('offers a Bind-to picker for an unresolved department and remembers the bind globally', async () => {
    await seedStore();
    const project = seedProject();
    const discipline = useStore.getState().createDiscipline({ name: 'Animation', color: '#4f7cff' });
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: 'OVR-EPIC', targetDate: null, notes: '' });
    // Jira spells the department "Anim" (key "anim"), which doesn't match "Animation" (key "animation").
    useStore.setState({ discoveredMissingLoqs: { [cinematic.id]: [
      { jiraKey: 'OVR-1', disciplineKey: 'anim', disciplineName: null, disciplineId: null, level: 'L1', summary: 'CIN Fixers-Anim-L1' },
    ] } });
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    expect(screen.getByText('1 LOQ in Jira not in this plan.')).toBeInTheDocument();
    const bind = document.querySelector('.missing-loq-bind') as HTMLElement;
    expect(bind).toBeTruthy(); // the "Bind to…" picker replaces the old "create the discipline first" hint
    // The row's checkbox is disabled until the department resolves to a discipline.
    expect(screen.getByRole('checkbox')).toBeDisabled();

    // Selecting a discipline only stages it; the explicit Bind button commits (so a correct pre-fill
    // can be accepted as-is, since a change event never fires for a value already shown).
    await user.selectOptions(within(bind).getByRole('combobox'), discipline.id);
    await user.click(within(bind).getByRole('button', { name: 'Bind' }));
    expect(useStore.getState().discoveryKeywordsGlobal?.animation).toContain('anim');
  });

  it('pre-fills the Bind picker with the discipline inferred from the LOQ assignee', async () => {
    await seedStore();
    const project = seedProject();
    const discipline = useStore.getState().createDiscipline({ name: 'Animation', color: '#4f7cff' });
    const pool = useStore.getState().createPool({ name: 'Animator', color: '#4f7cff', disciplineId: discipline.id, capacityFte: 0 });
    // The assignee resolves to a Person whose pool sits under the Animation discipline.
    useStore.getState().createPerson({ name: 'Ada Lovelace', poolId: pool.id, capacityFte: 1, active: true, notes: '', team: '', site: '' });
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: 'OVR-EPIC', targetDate: null, notes: '' });
    useStore.setState({ discoveredMissingLoqs: { [cinematic.id]: [
      { jiraKey: 'OVR-1', disciplineKey: 'anim', disciplineName: null, disciplineId: null, level: 'L1', summary: 'CIN Fixers-Anim-L1', assignee: 'Ada Lovelace' },
    ] } });
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    const bind = document.querySelector('.missing-loq-bind') as HTMLElement;
    // The picker already points at Animation — the user just confirms with Bind.
    expect((within(bind).getByRole('combobox') as HTMLSelectElement).value).toBe(discipline.id);
    await user.click(within(bind).getByRole('button', { name: 'Bind' }));
    expect(useStore.getState().discoveryKeywordsGlobal?.animation).toContain('anim');
  });

  it('adds a resolved discovered LOQ into the plan', async () => {
    await seedStore();
    const project = seedProject();
    const discipline = useStore.getState().createDiscipline({ name: 'Animation', color: '#4f7cff' });
    const cinematic = useStore.getState().createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: 'OVR-EPIC', targetDate: null, notes: '' });
    useStore.setState({ discoveredMissingLoqs: { [cinematic.id]: [
      { jiraKey: 'OVR-1', disciplineKey: 'animation', disciplineName: 'Animation', disciplineId: discipline.id, level: 'L1', summary: 'CIN Fixers-Anim-L1' },
    ] } });
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Add 1 selected LOQ/ }));

    const created = useStore.getState().data.loqs.find((l) => l.jiraKey === 'OVR-1');
    expect(created).toMatchObject({ cinematicId: cinematic.id, disciplineId: discipline.id, type: 'L1', status: 'TODO' });
  });
});
