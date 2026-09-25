import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { ProjectDetail } from '../../src/ui/views/ProjectDetail';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';

function seedProjectWithStaffing() {
  const { createDiscipline, createPool, createPerson, setDisciplineRequirement, setPersonAssignment } = useStore.getState();
  const discipline = createDiscipline({ name: 'Animation', color: '#4f7cff' });
  const pool = createPool({ name: 'Animator', color: '#4f7cff', disciplineId: discipline.id, capacityFte: 0 });
  const person = createPerson({ name: 'Ada Lovelace', poolId: pool.id, capacityFte: 1, active: true, notes: '', team: '', site: '' });
  const project = useStore.getState().createProject({
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
  setDisciplineRequirement(project.id, discipline.id, '2026-09', 2);
  setPersonAssignment(person.id, project.id, '2026-09', 1);
  return { discipline, pool, person, project };
}

describe('ProjectDetail', () => {
  it("renders a seeded project's discipline staffing", async () => {
    await seedStore();
    const { project } = seedProjectWithStaffing();
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('staffing');

    const { user } = renderView(<ProjectDetail projectId={project.id} />);

    expect(await screen.findByRole('heading', { name: 'Cinematic Alpha' })).toBeInTheDocument();
    expect(screen.getByText('Animation')).toBeInTheDocument();
    expect(screen.getByText('2 FTE')).toBeInTheDocument(); // the discipline need block

    // Discipline rows start collapsed — expand to reveal Ada's per-person assignment lane.
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('1 FTE')).toBeInTheDocument(); // Ada's assignment block
  });

  it('deletes the project through the two-step confirm and cleans up its requirements/assignments', async () => {
    await seedStore();
    const { project } = seedProjectWithStaffing();
    useUiStore.getState().openProject(project.id);
    const { user } = renderView(<ProjectDetail projectId={project.id} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm?' }));

    expect(useStore.getState().data.projects.some((p) => p.id === project.id)).toBe(false);
    expect(useStore.getState().data.requirements.some((r) => r.projectId === project.id)).toBe(false);
    expect(useStore.getState().data.personAssignments.some((a) => a.projectId === project.id)).toBe(false);
    expect(useUiStore.getState().view).toBe('projects');
  });

  it('reflects a requirement edit made through the store — the staffing gap appears and clears', async () => {
    await seedStore();
    const { project, discipline } = seedProjectWithStaffing();
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('staffing');
    const { user, container } = renderView(<ProjectDetail projectId={project.id} />);

    // Seeded need (2 FTE) doesn't match the 1 FTE assigned — the gap badge is showing.
    expect(await screen.findByText('2 FTE')).toBeInTheDocument();
    expect(container.querySelector('.req-need-gap')).toBeTruthy();

    // Discipline rows start collapsed — expand to see the assignment lane alongside the need lane.
    await user.click(screen.getByRole('button', { name: 'Expand' }));

    act(() => {
      useStore.getState().setDisciplineRequirement(project.id, discipline.id, '2026-09', 1);
    });

    // Need (now 1 FTE) matches the 1 FTE assigned — both the need and assignment blocks read "1 FTE".
    await screen.findAllByText('1 FTE');
    expect(screen.getAllByText('1 FTE')).toHaveLength(2);
    expect(container.querySelector('.req-need-gap')).toBeNull();
  });

  it('shows the understaffed FTE warning in the Staffing view, and no header "Warnings" section', async () => {
    await seedStore();
    const { project } = seedProjectWithStaffing();
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('staffing');
    renderView(<ProjectDetail projectId={project.id} />);

    expect(await screen.findByText('Staffing warnings')).toBeInTheDocument();
    expect(screen.getByText(/is understaffed on Animation/)).toBeInTheDocument();
    expect(screen.queryByText('Warnings')).not.toBeInTheDocument();
  });
});
