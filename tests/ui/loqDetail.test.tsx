import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { CinematicDetail } from '../../src/ui/views/CinematicDetail';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';

function seedProjectAndCinematic() {
  const { createDiscipline, createProject, createCinematic } = useStore.getState();
  const discipline = createDiscipline({ name: 'Animation', color: '#4f7cff' });
  const project = createProject({
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
  const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });
  return { discipline, project, cinematic };
}

describe('CinematicDetail — LOQ list', () => {
  it('shows an empty state, then creates a LOQ through the drawer', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    expect(screen.getByText('No LOQs yet. Add one to start scheduling this cinematic.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New LOQ' }));
    await user.selectOptions(screen.getByLabelText('Discipline'), discipline.id);
    await user.type(screen.getByLabelText('Type'), 'L1');
    await user.click(screen.getByRole('button', { name: 'Create LOQ' }));

    expect(await screen.findByText('L1')).toBeInTheDocument();
    const created = useStore.getState().data.loqs.find((l) => l.type === 'L1');
    expect(created?.cinematicId).toBe(cinematic.id);
    expect(created?.disciplineId).toBe(discipline.id);
    expect(created?.status).toBe('TODO');
  });

  it('edits status/estimate and deletes a LOQ', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    useStore.getState().createLoq({
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type: 'L1',
      status: 'TODO',
      estimateDays: 4,
      committedStart: null,
      committedFinish: null,
      actualFinish: null,
      dodRef: '',
    });
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    expect(screen.getByText('Unscheduled')).toBeInTheDocument();

    const table = screen.getByRole('table');
    const row = within(table).getByText('L1').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('In progress')).toBeInTheDocument();

    const updatedRow = within(table).getByText('L1').closest('tr')!;
    await user.click(within(updatedRow).getByRole('button', { name: 'Delete' }));
    await user.click(within(updatedRow).getByRole('button', { name: 'Confirm?' }));

    expect(useStore.getState().data.loqs).toHaveLength(0);
    expect(screen.getByText('No LOQs yet. Add one to start scheduling this cinematic.')).toBeInTheDocument();
  });

  it('does not expose committed-date inputs in the generic form; re-commits via the dedicated dialog', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    useStore.getState().createLoq({
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type: 'L1',
      status: 'TODO',
      estimateDays: 4,
      committedStart: null,
      committedFinish: null,
      actualFinish: null,
      dodRef: '',
    });
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    const table = screen.getByRole('table');
    const row = within(table).getByText('L1').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    expect(screen.queryByLabelText('Committed start')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Committed finish')).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Unscheduled')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Re-commit dates…' }));

    expect(screen.getByRole('heading', { name: 'Re-commit dates' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Committed start'), '2026-09-01');
    await user.type(screen.getByLabelText('Committed finish'), '2026-09-10');
    await user.click(screen.getByRole('button', { name: 'Re-commit' }));

    expect(await screen.findByText(/2026-09-01.*2026-09-10/)).toBeInTheDocument();
    const events = useStore.getState().data.loqCommitmentEvents;
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe('Initial commitment');
  });
});
