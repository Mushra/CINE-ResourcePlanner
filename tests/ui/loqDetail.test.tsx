import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { CinematicDetail } from '../../src/ui/views/CinematicDetail';
import { LoqDetail } from '../../src/ui/views/LoqDetail';
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

function makeLoq(cinematicId: string, disciplineId: string, over: Record<string, unknown> = {}) {
  return useStore.getState().createLoq({
    cinematicId,
    disciplineId,
    jiraKey: null,
    type: 'L1',
    status: 'TODO',
    estimateDays: 4,
    committedStart: null,
    committedFinish: null,
    actualFinish: null,
    dodRef: '',
    ...over,
  });
}

describe('CinematicDetail — LOQ list', () => {
  it('New LOQ opens a creation draft and only persists a validated LOQ, then opens its page', async () => {
    await seedStore();
    const { cinematic } = seedProjectAndCinematic();
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    expect(screen.getByText('No LOQs yet. Add one to start scheduling this cinematic.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New LOQ' }));
    // A15: opening the draft must not persist anything yet (the old flow created an empty-type row here).
    expect(useStore.getState().data.loqs).toHaveLength(0);
    expect(useUiStore.getState().view).toBe('cinematic-detail');

    // The draft requires a type before it can be created.
    const create = screen.getByRole('button', { name: 'Create LOQ' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('Type'), 'L1');
    await user.click(screen.getByRole('button', { name: 'Create LOQ' }));

    const created = useStore.getState().data.loqs.find((l) => l.cinematicId === cinematic.id);
    expect(created).toBeDefined();
    expect(created!.type).toBe('L1');
    expect(useUiStore.getState().view).toBe('loq-detail');
    expect(useUiStore.getState().selectedLoqId).toBe(created!.id);
  });

  it('New LOQ then Cancel leaves no LOQ behind (A15)', async () => {
    await seedStore();
    const { cinematic } = seedProjectAndCinematic();
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    await user.click(screen.getByRole('button', { name: 'New LOQ' }));
    await user.type(screen.getByLabelText('Type'), 'L1'); // even a half-filled draft…
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // …is discarded: no row persisted, still on the cinematic, nothing to clean up.
    expect(useStore.getState().data.loqs).toHaveLength(0);
    expect(useUiStore.getState().view).toBe('cinematic-detail');
    expect(screen.getByText('No LOQs yet. Add one to start scheduling this cinematic.')).toBeInTheDocument();
  });

  it('clicking a LOQ row opens the dedicated LOQ page', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const loq = makeLoq(cinematic.id, discipline.id);
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    const row = within(screen.getByRole('table')).getByText('L1').closest('tr')!;
    await user.click(row);

    expect(useUiStore.getState().view).toBe('loq-detail');
    expect(useUiStore.getState().selectedLoqId).toBe(loq.id);
  });

  it('deletes a LOQ from the row without navigating', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    makeLoq(cinematic.id, discipline.id);
    useUiStore.getState().openCinematic(cinematic.id);
    const { user } = renderView(<CinematicDetail cinematicId={cinematic.id} />);

    const row = within(screen.getByRole('table')).getByText('L1').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Confirm?' }));

    expect(useStore.getState().data.loqs).toHaveLength(0);
    expect(useUiStore.getState().view).toBe('cinematic-detail');
  });

  it('does not show a Dependencies editor (authoring lives on the LOQ page)', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    makeLoq(cinematic.id, discipline.id, { type: 'L1' });
    makeLoq(cinematic.id, discipline.id, { type: 'L2' });
    useUiStore.getState().openCinematic(cinematic.id);
    renderView(<CinematicDetail cinematicId={cinematic.id} />);

    await screen.findAllByText('L1');
    expect(screen.queryByLabelText('Predecessor')).not.toBeInTheDocument();
  });
});

describe('LoqDetail — page', () => {
  it('renders the LOQ title, discipline and status/health badges', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const loq = makeLoq(cinematic.id, discipline.id);
    useUiStore.getState().openLoq(loq.id, cinematic.id);
    renderView(<LoqDetail loqId={loq.id} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Animation L1' })).toBeInTheDocument();
    // Execution block carries the facts, with placeholders for data we don't have a source for yet.
    expect(screen.getByText('Versions')).toBeInTheDocument();
    expect(screen.getByText(/— \/ 4 days \(consumed\/estimated\)/)).toBeInTheDocument();
  });

  it('shows an upstream predecessor as a "Blocked by" dependency', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const upstream = makeLoq(cinematic.id, discipline.id, { type: 'L1' });
    const current = makeLoq(cinematic.id, discipline.id, { type: 'L2' });
    useStore.getState().createLoqDependency({
      predecessorLoqId: upstream.id, successorLoqId: current.id, type: 'finish_to_start', lagDays: 0, source: 'jira', templateId: null,
    });
    useUiStore.getState().openLoq(current.id, cinematic.id);
    renderView(<LoqDetail loqId={current.id} />);

    const depPanel = screen.getByText('Direct dependencies and affected LOQs').closest('.panel') as HTMLElement;
    expect(within(depPanel).getByText('Blocked by')).toBeInTheDocument();
    expect(within(depPanel).getByText('Animation L1')).toBeInTheDocument();
    // Jira-mirrored edges carry a source tag so they read as read-only.
    expect(within(depPanel).getByText('Jira')).toBeInTheDocument();
  });

  it('edits status + estimate inline and Save persists via updateLoq', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const loq = makeLoq(cinematic.id, discipline.id);
    useUiStore.getState().openLoq(loq.id, cinematic.id);
    const { user } = renderView(<LoqDetail loqId={loq.id} />);

    await user.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
    const estimate = screen.getByLabelText('Estimate (days)');
    await user.clear(estimate);
    await user.type(estimate, '6');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const updated = useStore.getState().data.loqs.find((l) => l.id === loq.id)!;
    expect(updated.status).toBe('IN_PROGRESS');
    expect(updated.estimateDays).toBe(6);
  });

  it('does not expose committed-date inputs inline; re-commits via the dedicated dialog', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const loq = makeLoq(cinematic.id, discipline.id);
    useUiStore.getState().openLoq(loq.id, cinematic.id);
    const { user } = renderView(<LoqDetail loqId={loq.id} />);

    expect(screen.queryByLabelText('Committed start')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Committed finish')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Re-commit dates…' }));
    expect(screen.getByRole('heading', { name: 'Re-commit dates' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Committed start'), '2026-09-01');
    await user.type(screen.getByLabelText('Committed finish'), '2026-09-10');
    await user.click(screen.getByRole('button', { name: 'Re-commit' }));

    const events = useStore.getState().data.loqCommitmentEvents.filter((e) => e.loqId === loq.id);
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe('Initial commitment');
  });

  it('hides the "Why is this LOQ at risk?" panel when the LOQ has no attention items', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const loq = makeLoq(cinematic.id, discipline.id);
    useUiStore.getState().openLoq(loq.id, cinematic.id);
    renderView(<LoqDetail loqId={loq.id} />);

    expect(screen.queryByRole('heading', { name: 'Why is this LOQ at risk?' })).not.toBeInTheDocument();
  });

  it('navigating directly from one LOQ to another swaps every field — no draft bleeds across', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const l1 = makeLoq(cinematic.id, discipline.id, {
      type: 'L1', status: 'DONE', estimateDays: 5, jiraKey: 'ALPHA-101', dodRef: 'dod-one',
    });
    const l2 = makeLoq(cinematic.id, discipline.id, {
      type: 'L2', status: 'IN_PROGRESS', estimateDays: 8, jiraKey: 'ALPHA-102', dodRef: 'dod-two',
    });
    useUiStore.getState().openLoq(l1.id, cinematic.id);
    const { rerender } = renderView(<LoqDetail loqId={l1.id} />);

    expect((screen.getByLabelText('Type') as HTMLInputElement).value).toBe('L1');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('DONE');
    expect((screen.getByLabelText('Estimate (days)') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Jira key') as HTMLInputElement).value).toBe('ALPHA-101');
    expect((screen.getByLabelText('Definition of done') as HTMLTextAreaElement).value).toBe('dod-one');

    // Same mounted element, new loqId — exactly what clicking a dependency node does.
    useUiStore.getState().openLoq(l2.id, cinematic.id);
    rerender(<LoqDetail loqId={l2.id} />);

    expect((screen.getByLabelText('Type') as HTMLInputElement).value).toBe('L2');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('IN_PROGRESS');
    expect((screen.getByLabelText('Estimate (days)') as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('Jira key') as HTMLInputElement).value).toBe('ALPHA-102');
    expect((screen.getByLabelText('Definition of done') as HTMLTextAreaElement).value).toBe('dod-two');

    // And back again — the draft tracks whichever LOQ is shown.
    useUiStore.getState().openLoq(l1.id, cinematic.id);
    rerender(<LoqDetail loqId={l1.id} />);
    expect((screen.getByLabelText('Type') as HTMLInputElement).value).toBe('L1');
    expect((screen.getByLabelText('Jira key') as HTMLInputElement).value).toBe('ALPHA-101');
  });

  it('Save stays disabled after navigating to another LOQ without editing it', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const l1 = makeLoq(cinematic.id, discipline.id, { type: 'L1', estimateDays: 5 });
    const l2 = makeLoq(cinematic.id, discipline.id, { type: 'L2', estimateDays: 8 });
    useUiStore.getState().openLoq(l1.id, cinematic.id);
    const { rerender } = renderView(<LoqDetail loqId={l1.id} />);

    rerender(<LoqDetail loqId={l2.id} />);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('an unsaved edit on one LOQ never transfers to — or is saved onto — the next', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const l1 = makeLoq(cinematic.id, discipline.id, { type: 'L1', estimateDays: 5 });
    const l2 = makeLoq(cinematic.id, discipline.id, { type: 'L2', estimateDays: 8 });
    useUiStore.getState().openLoq(l1.id, cinematic.id);
    const { user, rerender } = renderView(<LoqDetail loqId={l1.id} />);

    // Dirty L1's draft but do NOT save it.
    const estimate = screen.getByLabelText('Estimate (days)');
    await user.clear(estimate);
    await user.type(estimate, '99');

    // Navigate to L2, change nothing, and save.
    rerender(<LoqDetail loqId={l2.id} />);
    expect((screen.getByLabelText('Estimate (days)') as HTMLInputElement).value).toBe('8');
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();

    // L2 keeps its own value; L1's abandoned 99 never reached the store.
    expect(useStore.getState().data.loqs.find((l) => l.id === l2.id)!.estimateDays).toBe(8);
    expect(useStore.getState().data.loqs.find((l) => l.id === l1.id)!.estimateDays).toBe(5);
  });

  it('editing and saving L2 does not touch any field of L1', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const l1 = makeLoq(cinematic.id, discipline.id, { type: 'L1', status: 'TODO', estimateDays: 5, jiraKey: 'ALPHA-101' });
    const l2 = makeLoq(cinematic.id, discipline.id, { type: 'L2', status: 'TODO', estimateDays: 8, jiraKey: 'ALPHA-102' });
    useUiStore.getState().openLoq(l2.id, cinematic.id);
    const { user, rerender } = renderView(<LoqDetail loqId={l2.id} />);

    await user.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
    const estimate = screen.getByLabelText('Estimate (days)');
    await user.clear(estimate);
    await user.type(estimate, '12');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const storedL1 = useStore.getState().data.loqs.find((l) => l.id === l1.id)!;
    expect(storedL1).toMatchObject({ type: 'L1', status: 'TODO', estimateDays: 5, jiraKey: 'ALPHA-101' });
    const storedL2 = useStore.getState().data.loqs.find((l) => l.id === l2.id)!;
    expect(storedL2).toMatchObject({ status: 'IN_PROGRESS', estimateDays: 12 });

    // Returning to L1 shows its untouched values.
    rerender(<LoqDetail loqId={l1.id} />);
    expect((screen.getByLabelText('Estimate (days)') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('TODO');
  });

  it('declares a variance on the LOQ through the dedicated dialog', async () => {
    await seedStore();
    const { discipline, cinematic } = seedProjectAndCinematic();
    const loq = makeLoq(cinematic.id, discipline.id, { committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    useUiStore.getState().openLoq(loq.id, cinematic.id);
    const { user } = renderView(<LoqDetail loqId={loq.id} />);

    await user.click(screen.getByRole('button', { name: 'Declare variance' }));
    expect(screen.getByRole('heading', { name: 'Declare variance' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Category'), 'TECHNICAL_ISSUE');
    const expectedFinish = screen.getByLabelText('Expected finish');
    await user.clear(expectedFinish);
    await user.type(expectedFinish, '2026-09-15');
    await user.click(screen.getByRole('button', { name: 'Declare' }));

    const stored = useStore.getState().data.varianceEvents.filter((e) => e.loqId === loq.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].category).toBe('TECHNICAL_ISSUE');
    expect(stored[0].deltaDays).toBe(5);
  });
});
