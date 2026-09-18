import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useUiStore } from '../../src/store/useUiStore';

/**
 * Under jsdom, sql.js detects browser-like globals and tries to fetch the wasm binary from
 * `locateFile`'s URL instead of reading it off disk the way it does in the plain-Node unit project
 * — there's no dev server here to serve it. Passing `wasmBinary` up front makes it skip that lookup
 * entirely, in both environments, so production's `locateFile` is never exercised or changed for this.
 */
vi.mock('sql.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sql.js')>();
  const wasmBinary = readFileSync(join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'));
  return { ...actual, default: (config?: Record<string, unknown>) => actual.default({ ...config, wasmBinary }) };
});

/**
 * Node's own global `localStorage` (jsdom 30 defers to it rather than implementing its own) throws
 * on first access unless started with --localstorage-file, which we don't control under vitest's
 * worker pool — so replace it with a plain in-memory Storage before any app code reads it.
 */
class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length(): number { return this.#data.size; }
  clear(): void { this.#data.clear(); }
  getItem(key: string): string | null { return this.#data.has(key) ? this.#data.get(key)! : null; }
  key(index: number): string | null { return [...this.#data.keys()][index] ?? null; }
  removeItem(key: string): void { this.#data.delete(key); }
  setItem(key: string, value: string): void { this.#data.set(key, String(value)); }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });

// jsdom implements neither PointerEvent nor pointer capture — the requirement timeline's drag
// editor calls these unconditionally on every pointerdown, so without a stub any click on it throws.
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUiStore.setState({
    view: 'dashboard',
    selectedProjectId: null,
    selectedPersonId: null,
    collapsed: {},
    globalFilter: { sites: null, teams: null, disciplineIds: null },
    peopleMode: 'availability',
  });
});
