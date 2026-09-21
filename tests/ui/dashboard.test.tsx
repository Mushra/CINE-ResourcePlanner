import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { Dashboard } from '../../src/ui/views/Dashboard';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';

function kpiValue(label: string): string {
  const labelEl = screen.getByText(label);
  const tile = labelEl.closest('.kpi-tile')!;
  return tile.querySelector('.kpi-value')!.textContent ?? '';
}

function seedActiveUnderstaffedProject() {
  const { createDiscipline, createPool, createPerson, createProject, setDisciplineRequirement } = useStore.getState();
  const discipline = createDiscipline({ name: 'Animation', color: '#4f7cff' });
  const pool = createPool({ name: 'Animator', color: '#4f7cff', disciplineId: discipline.id, capacityFte: 0 });
  const person = createPerson({ name: 'Ada Lovelace', poolId: pool.id, capacityFte: 1, active: true, notes: '', team: '', site: 'Paris' });
  const project = createProject({
    name: 'Cinematic Alpha',
    status: 'planned',
    startDate: '2026-01-01',
    startCertainty: 'confirmed',
    endDate: '2026-12-31',
    endCertainty: 'confirmed',
    priority: 'medium',
    notes: '',
    isDispo: false,
  });
  setDisciplineRequirement(project.id, discipline.id, '2026-09', 2); // nobody assigned — understaffed
  return { discipline, pool, person, project };
}

describe('Dashboard', () => {
  it('shows KPIs and a needs-attention entry for an understaffed active project', async () => {
    await seedStore();
    const { project } = seedActiveUnderstaffedProject();

    renderView(<Dashboard />);

    expect(await screen.findByText('Active projects')).toBeInTheDocument();
    expect(kpiValue('Active projects')).toBe('1');
    expect(kpiValue('Understaffed projects')).toBe('1');
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(project.name))).toBeInTheDocument();
  });

  it('nests a root-cause LOQ chain (A -> B -> C) instead of showing three flat rows', async () => {
    await seedStore();
    const { createDiscipline, createProject, createCinematic, createLoq, createLoqDependency, declareVariance } = useStore.getState();
    const discipline = createDiscipline({ name: 'Animation', color: '#4f7cff' });
    const project = createProject({
      name: 'Cinematic Alpha',
      status: 'active',
      startDate: '2026-09-01',
      startCertainty: 'confirmed',
      endDate: '2026-12-31',
      endCertainty: 'confirmed',
      priority: 'medium',
      notes: '',
      isDispo: false,
    });
    const cinematic = createCinematic({ projectId: project.id, name: 'Seq01', targetDate: null, notes: '' });
    const base = {
      cinematicId: cinematic.id,
      disciplineId: discipline.id,
      jiraKey: null,
      status: 'TODO' as const,
      estimateDays: 8,
      actualFinish: null,
      dodRef: '',
    };
    const a = createLoq({ ...base, type: 'L1', committedStart: '2026-09-01', committedFinish: '2026-09-10' });
    const b = createLoq({ ...base, type: 'L2', committedStart: '2026-09-11', committedFinish: '2026-09-20' });
    const c = createLoq({ ...base, type: 'L3', committedStart: '2026-09-21', committedFinish: '2026-09-30' });
    createLoqDependency({ predecessorLoqId: a.id, successorLoqId: b.id, type: 'finish_to_start', lagDays: 0, source: 'override', templateId: null });
    createLoqDependency({ predecessorLoqId: b.id, successorLoqId: c.id, type: 'finish_to_start', lagDays: 0, source: 'override', templateId: null });
    declareVariance(a.id, { category: 'TECHNICAL_ISSUE', expectedFinish: '2026-09-15', comment: 'Render farm outage' });

    renderView(<Dashboard />);

    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText(/is the root cause of 2 downstream delays/)).toBeInTheDocument();

    // The two impacted LOQs appear nested under the root cause, not as their own top-level rows.
    expect(screen.getByText(/Animation · L2/)).toBeInTheDocument();
    expect(screen.getByText(/Animation · L3/)).toBeInTheDocument();
    expect(document.querySelectorAll('.issue-impact-chain-row')).toHaveLength(2);

    // Neither the root cause nor its impacted LOQs surface a separate flat loq_at_risk row.
    expect(screen.queryByText(/is forecast to finish/)).not.toBeInTheDocument();
  });

  it('narrows total capacity when the global site filter excludes the only seeded person', async () => {
    await seedStore();
    seedActiveUnderstaffedProject();

    renderView(<Dashboard />);

    expect(await screen.findByText('Total capacity')).toBeInTheDocument();
    expect(kpiValue('Total capacity')).toBe('1 FTE');

    act(() => {
      useUiStore.getState().setGlobalFilter({ sites: ['London'], teams: null, disciplineIds: null });
    });

    expect(kpiValue('Total capacity')).toBe('0 FTE');
  });
});
