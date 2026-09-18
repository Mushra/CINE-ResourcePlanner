import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Dashboard } from '../../src/ui/views/Dashboard';
import { renderView, seedDemoStore } from './harness';

describe('smoke', () => {
  it('renders the Dashboard against a real sql.js-backed demo database without crashing', async () => {
    await seedDemoStore();
    renderView(<Dashboard />);

    expect(await screen.findByText('Active projects')).toBeInTheDocument();
  });

  it('surfaces a capacity_conflict_cinematic check from the seeded LOQ demand', async () => {
    await seedDemoStore();
    renderView(<Dashboard />);

    expect(await screen.findByText(/Cinematic Alpha's LOQ demand for Animation exceeds its requirement in Nov 2026/)).toBeInTheDocument();
  });
});
