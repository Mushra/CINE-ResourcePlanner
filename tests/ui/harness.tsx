import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useStore } from '../../src/store/useStore';

/**
 * Fresh, empty sql.js-backed database via the real store action. Tests build their own fixture on
 * top of it with the same store actions the UI uses (createProject, createPool, ...), so
 * persist()/reload() run for real and a test exercises component + store + engine + repository
 * together — the same integration surface a real interaction would touch.
 */
export async function seedStore(): Promise<void> {
  await useStore.getState().newDatabase(false);
}

/** The same demo dataset "Load demo plan" seeds — for tests that just need a populated, realistic plan. */
export async function seedDemoStore(): Promise<void> {
  await useStore.getState().newDatabase(true);
}

export function renderView(node: ReactElement) {
  const user = userEvent.setup();
  return { user, ...render(node) };
}
