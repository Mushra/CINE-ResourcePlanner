import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { LoqTimeline } from '../../src/ui/components/LoqTimeline';
import { useStore } from '../../src/store/useStore';
import { renderView, seedStore } from './harness';

function seedScheduledLoq() {
  const { createDiscipline, createProject, createCinematic, createLoq, createPerson } = useStore.getState();
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
  const loq = createLoq({
    cinematicId: cinematic.id,
    disciplineId: discipline.id,
    jiraKey: null,
    type: 'L1',
    status: 'TODO',
    estimateDays: 4,
    committedStart: '2026-09-07',
    committedFinish: '2026-09-11',
    actualFinish: null,
    dodRef: '',
  });
  const person = createPerson({ name: 'Alex Rivera', poolId: null, capacityFte: 1, active: true, notes: '', team: '', site: '' });
  return { discipline, project, cinematic, loq, person };
}

describe('LoqTimeline', () => {
  it('renders a bar for a committed LOQ and nothing for an unscheduled one', async () => {
    await seedStore();
    const { cinematic, loq } = seedScheduledLoq();
    useStore.getState().createLoq({
      cinematicId: cinematic.id,
      disciplineId: loq.disciplineId,
      jiraKey: null,
      type: 'L2',
      status: 'TODO',
      estimateDays: null,
      committedStart: null,
      committedFinish: null,
      actualFinish: null,
      dodRef: '',
    });
    renderView(<LoqTimeline cinematicId={cinematic.id} onEditLoq={vi.fn()} />);

    expect(screen.getByTitle('L1: 2026-09-07 → 2026-09-11')).toBeInTheDocument();
    expect(screen.getByText(/Unscheduled — set a start date/)).toBeInTheDocument();
  });

  it('opens the LOQ editor when the bar is clicked (not dragged)', async () => {
    await seedStore();
    const { cinematic, loq } = seedScheduledLoq();
    const onEditLoq = vi.fn();
    const { user } = renderView(<LoqTimeline cinematicId={cinematic.id} onEditLoq={onEditLoq} />);

    const bar = screen.getByTitle('L1: 2026-09-07 → 2026-09-11');
    await user.click(within(bar).getByRole('button'));
    expect(onEditLoq).toHaveBeenCalledWith(expect.objectContaining({ id: loq.id }));
  });

  it('re-renders the bar after a committed-date change made via the store action', async () => {
    await seedStore();
    const { cinematic, loq } = seedScheduledLoq();
    renderView(<LoqTimeline cinematicId={cinematic.id} onEditLoq={vi.fn()} />);

    expect(screen.getByTitle('L1: 2026-09-07 → 2026-09-11')).toBeInTheDocument();

    act(() => {
      useStore.getState().updateLoq({ ...loq, committedStart: '2026-09-14', committedFinish: '2026-09-18' });
    });

    expect(screen.queryByTitle('L1: 2026-09-07 → 2026-09-11')).not.toBeInTheDocument();
    expect(screen.getByTitle('L1: 2026-09-14 → 2026-09-18')).toBeInTheDocument();
  });

  it('expands a LOQ row to assign a person and edit their window', async () => {
    await seedStore();
    const { cinematic, loq, person } = seedScheduledLoq();
    const { user } = renderView(<LoqTimeline cinematicId={cinematic.id} onEditLoq={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await user.selectOptions(screen.getByRole('combobox'), person.id);

    expect(await screen.findByText('Alex Rivera')).toBeInTheDocument();
    const resource = useStore.getState().data.loqResources.find((r) => r.personId === person.id);
    expect(resource?.loqId).toBe(loq.id);
    expect(resource?.startDate).toBe('2026-09-07');
    expect(resource?.fte).toBe(1);

    const bar = screen.getByTitle(/1 FTE:/);
    await user.click(within(bar).getByRole('button'));
    const editor = screen.getByRole('spinbutton');
    await user.clear(editor);
    await user.type(editor, '0.5');
    await user.tab();

    expect(useStore.getState().data.loqResources.find((r) => r.personId === person.id)?.fte).toBe(0.5);

    const row = screen.getByText('Alex Rivera').closest('.loq-resource-row')!;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(useStore.getState().data.loqResources.some((r) => r.personId === person.id)).toBe(false);
  });
});
