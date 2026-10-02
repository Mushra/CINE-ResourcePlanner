import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { SettingsView } from '../../src/ui/views/SettingsView';
import { useStore } from '../../src/store/useStore';
import { renderView, seedStore } from './harness';

function seedPlan() {
  const { createDiscipline, createProject, createCinematic, createLoq } = useStore.getState();
  const tech = createDiscipline({ name: 'Tech Anim', color: '#111' });
  const anim = createDiscipline({ name: 'Anim', color: '#222' });
  const project = createProject({
    name: 'Movie A', status: 'planned', startDate: '2026-09-01', startCertainty: 'confirmed',
    endDate: '2026-12-31', endCertainty: 'confirmed', priority: 'medium', notes: '', isDispo: false,
  });
  const cinematic = createCinematic({ projectId: project.id, name: 'Seq010', jiraKey: null, targetDate: null, notes: '' });
  const mk = (disciplineId: string, type: string) => createLoq({
    cinematicId: cinematic.id, disciplineId, jiraKey: null, type, status: 'TODO',
    estimateDays: 3, committedStart: null, committedFinish: null, actualFinish: null, dodRef: '',
  });
  return { tech, anim, cinematic, techLoq: mk(tech.id, 'L0'), animLoq: mk(anim.id, 'L0') };
}

describe('DependencyFlowEditor (Settings)', () => {
  it('adds a flow row, edits it, and Apply materializes a source=template edge between matching LOQs', async () => {
    await seedStore();
    const { tech, anim, techLoq, animLoq } = seedPlan();
    const { user } = renderView(<SettingsView />);

    const card = screen.getByText('Dependency flow').closest('.settings-card') as HTMLElement;

    await user.click(within(card).getByRole('button', { name: 'Ajouter une dépendance' }));
    // One template row is created immediately (both ends default to the first discipline).
    expect(useStore.getState().data.dependencyTemplates).toHaveLength(1);

    await user.selectOptions(within(card).getByLabelText('Predecessor discipline'), 'Tech Anim');
    await user.selectOptions(within(card).getByLabelText('Successor discipline'), 'Anim');
    await user.clear(within(card).getByLabelText('Predecessor LOQ type'));
    await user.type(within(card).getByLabelText('Predecessor LOQ type'), 'L0');
    await user.clear(within(card).getByLabelText('Successor LOQ type'));
    await user.type(within(card).getByLabelText('Successor LOQ type'), 'L0');

    await user.click(within(card).getByRole('button', { name: 'Appliquer le flow maintenant' }));

    const tpl = useStore.getState().data.dependencyTemplates[0];
    expect(tpl).toMatchObject({ predecessorDisciplineId: tech.id, successorDisciplineId: anim.id, predecessorLoqType: 'L0', successorLoqType: 'L0' });

    const edges = useStore.getState().data.loqDependencies;
    expect(edges).toEqual([
      expect.objectContaining({ predecessorLoqId: techLoq.id, successorLoqId: animLoq.id, source: 'template', templateId: tpl.id }),
    ]);
  });

  it('deletes a flow row through its two-step confirm', async () => {
    await seedStore();
    seedPlan();
    const { user } = renderView(<SettingsView />);
    const card = screen.getByText('Dependency flow').closest('.settings-card') as HTMLElement;

    await user.click(within(card).getByRole('button', { name: 'Ajouter une dépendance' }));
    expect(useStore.getState().data.dependencyTemplates).toHaveLength(1);

    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    await user.click(within(card).getByRole('button', { name: 'Confirm?' }));
    expect(useStore.getState().data.dependencyTemplates).toHaveLength(0);
  });
});
