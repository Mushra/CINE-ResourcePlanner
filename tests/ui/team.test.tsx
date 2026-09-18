import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Team } from '../../src/ui/views/Team';
import { useStore } from '../../src/store/useStore';
import { normalizeKey } from '../../src/domain/identity';
import { renderView, seedStore } from './harness';

function seedTeam() {
  const { createDiscipline, createPool, createPerson } = useStore.getState();
  const discipline = createDiscipline({ name: 'Animation', color: '#4f7cff' });
  const animator = createPool({ name: 'Animator', color: '#4f7cff', disciplineId: discipline.id, capacityFte: 0 });
  const rigger = createPool({ name: 'Rigger', color: '#7c4fff', disciplineId: discipline.id, capacityFte: 0 });
  const person = createPerson({ name: 'Ada Lovelace', poolId: animator.id, capacityFte: 1, active: true, notes: '', team: '', site: '' });
  return { discipline, animator, rigger, person };
}

describe('Team', () => {
  it('renders disciplines, roles and people', async () => {
    await seedStore();
    seedTeam();

    renderView(<Team />);

    expect(await screen.findByText('Animation')).toBeInTheDocument();
    expect(screen.getByText('Animator')).toBeInTheDocument();
    expect(screen.getByText('Rigger')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('relocates a person to another role through a named override, with no baseline mutation', async () => {
    await seedStore();
    const { rigger, person } = seedTeam();
    const { user } = renderView(<Team />);

    const row = (await screen.findByText('Ada Lovelace')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: '' })); // the pencil edit button (icon-only)

    const roleSelect = await screen.findByLabelText('Role');
    await user.selectOptions(roleSelect, rigger.id);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const updated = useStore.getState().data.people.find((p) => p.id === person.id)!;
    expect(updated.poolId).toBe(rigger.id); // effective role changed
    expect(updated.importPoolId).not.toBe(rigger.id); // baseline import value untouched

    const override = useStore.getState().data.structureOverrides.find(
      (o) => o.kind === 'person_pool' && o.sourceKey === normalizeKey(person.name),
    );
    expect(override).toBeTruthy();
    expect(override!.targetKey).toBe(normalizeKey(rigger.name));

    expect(screen.getByTitle(/Role override active/)).toBeInTheDocument();
  });
});
