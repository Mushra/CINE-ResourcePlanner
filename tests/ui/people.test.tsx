import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { People } from '../../src/ui/views/People';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';

describe('People', () => {
  it('shows spare capacity in the default Availability panel', async () => {
    await seedStore();
    const { createDiscipline, createPool, createPerson } = useStore.getState();
    const discipline = createDiscipline({ name: 'Animation', color: '#4f7cff' });
    const pool = createPool({ name: 'Animator', color: '#4f7cff', disciplineId: discipline.id, capacityFte: 0 });
    createPerson({ name: 'Ada Lovelace', poolId: pool.id, capacityFte: 1, active: true, notes: '', team: '', site: '' });

    renderView(<People />);

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Animator')).toBeInTheDocument();
  });

  it('switches to Assignments and navigates to a person from there', async () => {
    await seedStore();
    const { createDiscipline, createPool, createPerson, createProject, setPersonAssignment } = useStore.getState();
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
    setPersonAssignment(person.id, project.id, '2026-09', 1);

    const { user } = renderView(<People />);

    await user.click(screen.getByRole('button', { name: 'Assignments' }));
    expect(await screen.findByText('Cinematic Alpha')).toBeInTheDocument();

    await user.click(screen.getByText('Ada Lovelace'));
    expect(useUiStore.getState().view).toBe('person-detail');
    expect(useUiStore.getState().selectedPersonId).toBe(person.id);
  });
});
