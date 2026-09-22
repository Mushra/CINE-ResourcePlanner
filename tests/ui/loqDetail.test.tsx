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
  const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: null, notes: '' });
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

  it('declares a variance on a LOQ through the dedicated dialog', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const loq = useStore.getState().createLoq({
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type: 'L1',
      status: 'TODO',
      estimateDays: 4,
      committedStart: '2026-09-01',
      committedFinish: '2026-09-10',
      actualFinish: null,
      dodRef: '',
    });
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    const table = screen.getByRole('table');
    const row = within(table).getByText('L1').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Variance' }));

    expect(screen.getByRole('heading', { name: 'Declare variance' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Category'), 'TECHNICAL_ISSUE');
    const expectedFinish = screen.getByLabelText('Expected finish');
    await user.clear(expectedFinish);
    await user.type(expectedFinish, '2026-09-15');
    await user.click(screen.getByRole('button', { name: 'Declare' }));

    await screen.findByRole('button', { name: 'Variance' });
    const stored = useStore.getState().data.varianceEvents.filter((e) => e.loqId === loq.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].category).toBe('TECHNICAL_ISSUE');
    expect(stored[0].deltaDays).toBe(5);

    const reopenedRow = within(screen.getByRole('table')).getByText('L1').closest('tr')!;
    await user.click(within(reopenedRow).getByRole('button', { name: 'Variance' }));
    expect(await screen.findByRole('heading', { name: 'Declared variances' })).toBeInTheDocument();
    expect(screen.getByText(/Technical issue.*\+5d/)).toBeInTheDocument();
  });

  it('adds, edits the lag of, and deletes a dependency; rejects one that would create a cycle', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const { createLoq } = useStore.getState();
    const base = {
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      status: 'TODO' as const,
      estimateDays: 4,
      committedStart: null,
      committedFinish: null,
      actualFinish: null,
      dodRef: '',
    };
    const first = createLoq({ ...base, type: 'L1' });
    const second = createLoq({ ...base, type: 'L2' });
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    expect(screen.getByText('No dependencies yet.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Predecessor'), first.id);
    await user.selectOptions(screen.getByLabelText('Successor'), second.id);
    await user.click(screen.getByRole('button', { name: 'Add dependency' }));

    expect(await screen.findByText(new RegExp(`${discipline.name} · L1.*${discipline.name} · L2`))).toBeInTheDocument();
    const dep = useStore.getState().data.loqDependencies[0];
    expect(dep.predecessorLoqId).toBe(first.id);
    expect(dep.successorLoqId).toBe(second.id);
    expect(dep.lagDays).toBe(0);

    const lagInput = screen.getByLabelText(`Lag for ${discipline.name} · L1 → ${discipline.name} · L2`);
    await user.clear(lagInput);
    await user.type(lagInput, '3');
    await user.tab();
    expect(useStore.getState().data.loqDependencies.find((d) => d.id === dep.id)?.lagDays).toBe(3);

    await user.selectOptions(screen.getByLabelText('Predecessor'), second.id);
    await user.selectOptions(screen.getByLabelText('Successor'), first.id);
    await user.click(screen.getByRole('button', { name: 'Add dependency' }));
    expect(useStore.getState().data.loqDependencies).toHaveLength(1);
    expect(useStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true);

    const depRow = screen.getByText(new RegExp(`${discipline.name} · L1.*${discipline.name} · L2`)).closest('li')!;
    await user.click(within(depRow).getByRole('button', { name: 'Delete' }));
    await user.click(within(depRow).getByRole('button', { name: 'Confirm?' }));
    expect(useStore.getState().data.loqDependencies).toHaveLength(0);
    expect(screen.getByText('No dependencies yet.')).toBeInTheDocument();
  });
});
