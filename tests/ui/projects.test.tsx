import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Projects } from '../../src/ui/views/Projects';
import { useStore } from '../../src/store/useStore';
import { useUiStore } from '../../src/store/useUiStore';
import { renderView, seedStore } from './harness';

describe('Projects', () => {
  it('renders a seeded project with its derived status label', async () => {
    await seedStore();
    useStore.getState().createProject({
      name: 'Cinematic Alpha',
      status: 'planned',
      startDate: '2020-01-01',
      startCertainty: 'confirmed',
      endDate: '2020-06-30',
      endCertainty: 'confirmed',
      priority: 'medium',
      notes: '',
      isDispo: false,
    });

    renderView(<Projects />);

    expect(await screen.findByText('Cinematic Alpha')).toBeInTheDocument();
    // Dates are long past — the stored "planned" status must not win over what the dates imply.
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('creates a project through the New project drawer', async () => {
    await seedStore();
    const { user } = renderView(<Projects />);

    // With zero projects the empty-state renders its own "New project" button alongside the
    // toolbar one — take the toolbar's (first in document order).
    await user.click(screen.getAllByRole('button', { name: 'New project' })[0]);
    await user.type(screen.getByLabelText('Name'), 'Cinematic Beta');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('Cinematic Beta')).toBeInTheDocument();
    expect(useStore.getState().data.projects.some((p) => p.name === 'Cinematic Beta')).toBe(true);
  });

  it('navigates to the project detail view when a row is clicked', async () => {
    await seedStore();
    const project = useStore.getState().createProject({
      name: 'Cinematic Gamma',
      status: 'planned',
      startDate: null,
      startCertainty: 'tbd',
      endDate: null,
      endCertainty: 'tbd',
      priority: 'medium',
      notes: '',
      isDispo: false,
    });
    const { user } = renderView(<Projects />);

    await user.click(await screen.findByText('Cinematic Gamma'));

    expect(useUiStore.getState().view).toBe('project-detail');
    expect(useUiStore.getState().selectedProjectId).toBe(project.id);
  });
});
