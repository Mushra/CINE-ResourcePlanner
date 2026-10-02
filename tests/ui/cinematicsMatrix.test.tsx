import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ProjectDetail } from '../../src/ui/views/ProjectDetail';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';

/** Seeds one cinematic whose single (cinematic, discipline) cell holds two LOQs: an in-progress
 * representative and a blocked sibling behind it — the A06 masking scenario. */
function seedMaskedBlock() {
  const { createDiscipline, createProject, createCinematic, createLoq } = useStore.getState();
  const discipline = createDiscipline({ name: 'Animation', color: '#4f7cff' });
  const project = createProject({
    name: 'Cinematic Alpha', status: 'active', startDate: '2026-09-01', startCertainty: 'confirmed',
    endDate: '2026-12-31', endCertainty: 'confirmed', priority: 'medium', notes: '', isDispo: false,
  });
  const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: null, notes: '' });
  const base = {
    cinematicId: cinematic.id, disciplineId: discipline.id, jiraKey: null, estimateDays: 4,
    committedFinish: '2026-10-10', actualFinish: null, dodRef: '',
  };
  const rep = createLoq({ ...base, type: 'L1', status: 'IN_PROGRESS', committedStart: '2026-10-01' });
  const blocked = createLoq({ ...base, type: 'L2', status: 'BLOCKED', committedStart: '2026-11-01' });
  return { project, cinematic, rep, blocked };
}

describe('CinematicsMatrix — A06 masked block', () => {
  it('surfaces a blocked sibling the representative hides, and opens it on click', async () => {
    await seedStore();
    const { project, blocked } = seedMaskedBlock();
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('production');
    useUiStore.getState().setProductionScreen('matrix');
    const { user } = renderView(<ProjectDetail projectId={project.id} />);

    // The cell shows the in-progress representative…
    expect(await screen.findByText('L1')).toBeInTheDocument();
    // …and an openable alert for the blocked sibling it would otherwise mask.
    const badge = screen.getByTitle(/1 blocked LOQ behind this one/i);
    expect(badge).toBeInTheDocument();
    // The cinematic's health rolls up to BLOCKED rather than reading on-track.
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();

    await user.click(badge);
    expect(useUiStore.getState().view).toBe('loq-detail');
    expect(useUiStore.getState().selectedLoqId).toBe(blocked.id);
  });
});
