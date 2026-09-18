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
