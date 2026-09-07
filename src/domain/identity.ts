/**
 * Shared name-key used to match rows by name across imports and structure overrides — the RPM
 * importer merges by this key, so overrides keyed the same way keep applying after a re-import.
 */
export function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Naming convention for the hidden, auto-created pool that carries a discipline-level requirement
 * (a "need N people from this discipline" with no specific role picked yet). Kept as a real pool
 * so the engine, validation, and export never need to know about discipline-level demand — they
 * only ever see pools. UI views filter these out of every role picker/listing via isGenericPoolName.
 */
const GENERIC_POOL_SUFFIX = ' — Unspecified role';

export function genericPoolName(disciplineName: string): string {
  return `${disciplineName}${GENERIC_POOL_SUFFIX}`;
}

export function isGenericPoolName(poolName: string): boolean {
  return poolName.endsWith(GENERIC_POOL_SUFFIX);
}
