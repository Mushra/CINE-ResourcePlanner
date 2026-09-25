import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ProjectDetail } from '../../src/ui/views/ProjectDetail';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';

/** 6 at-risk LOQs (more than the Attention panel's top-5 cap) split across two cinematics, a
 * cross-cinematic dependency edge between them, and an unrelated FTE/staffing gap that must never
 * surface in Attention Required. */
function seedProjectWithPlanningAndStaffingIssues() {
  const {
    createDiscipline, createPool, createPerson, createProject, createCinematic, createLoq,
    declareVariance, setDisciplineRequirement, setPersonAssignment, createLoqDependency,
  } = useStore.getState();

  const discipline = createDiscipline({ name: 'Animation', color: '#4f7cff' });
  const pool = createPool({ name: 'Animator', color: '#4f7cff', disciplineId: discipline.id, capacityFte: 0 });
  const person = createPerson({ name: 'Ada Lovelace', poolId: pool.id, capacityFte: 1, active: true, notes: '', team: '', site: '' });
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
  const cinA = createCinematic({ projectId: project.id, name: 'Seq01', jiraKey: null, targetDate: null, notes: '' });
  const cinB = createCinematic({ projectId: project.id, name: 'Seq02', jiraKey: null, targetDate: null, notes: '' });

  const loqs = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((type, i) => {
    const loq = createLoq({
      cinematicId: i < 3 ? cinA.id : cinB.id,
      disciplineId: discipline.id,
      jiraKey: null,
      type,
      status: 'TODO',
      estimateDays: 4,
      committedStart: '2026-09-01',
      committedFinish: '2026-09-10',
      actualFinish: null,
      dodRef: '',
    });
    // 7 calendar days late — past the 5-day critical threshold (loq_at_risk).
    declareVariance(loq.id, { category: 'TECHNICAL_ISSUE', expectedFinish: '2026-09-17', comment: 'slip' });
    return loq;
  });

  // FTE/staffing gap — 'Production Planning' source, must surface in Staffing, never in Attention Required.
  setDisciplineRequirement(project.id, discipline.id, '2026-09', 2);
  setPersonAssignment(person.id, project.id, '2026-09', 1);

  // Cross-cinematic edge — invisible to LoqDependencyEditor, which only shows edges within one cinematic.
  createLoqDependency({
    predecessorLoqId: loqs[0].id,
    successorLoqId: loqs[3].id,
    type: 'finish_to_start',
    lagDays: 2,
    source: 'override',
    templateId: null,
  });

  return { project, cinA, cinB, loqs };
}

describe('ControlRoom', () => {
  it('caps Attention Required at the top 5 planning issues and excludes the staffing/FTE one', async () => {
    await seedStore();
    const { project } = seedProjectWithPlanningAndStaffingIssues();
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('production');
    useUiStore.getState().setProductionScreen('control');
    renderView(<ProjectDetail projectId={project.id} />);

    expect(await screen.findByText('Top 5 of 6 planning issues')).toBeInTheDocument();
    expect(screen.getAllByText(/is forecast to finish 7d late/)).toHaveLength(5);
    expect(screen.queryByText(/is understaffed on Animation/)).not.toBeInTheDocument();
  });

  it('lists a cross-cinematic dependency edge and opens the right cinematic on click', async () => {
    await seedStore();
    const { project, cinA, cinB } = seedProjectWithPlanningAndStaffingIssues();
    useUiStore.getState().openProject(project.id);
    useUiStore.getState().setProjectView('production');
    useUiStore.getState().setProductionScreen('control');
    const { user } = renderView(<ProjectDetail projectId={project.id} />);

    expect(await screen.findByText('Dependencies')).toBeInTheDocument();
    const predecessorButton = screen.getByText(`${cinA.name} · Animation · L1`);
    expect(screen.getByText(`${cinB.name} · Animation · L4`)).toBeInTheDocument();

    await user.click(predecessorButton);
    expect(useUiStore.getState().view).toBe('cinematic-detail');
    expect(useUiStore.getState().selectedCinematicId).toBe(cinA.id);
  });
});
