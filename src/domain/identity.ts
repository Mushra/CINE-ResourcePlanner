/**
 * Shared name-key used to match rows by name across imports and structure overrides — the RPM
 * importer merges by this key, so overrides keyed the same way keep applying after a re-import.
 */
export function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}
