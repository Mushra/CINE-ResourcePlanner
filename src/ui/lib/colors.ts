/** Deterministic color for entities that carry no `color` field of their own (e.g. Project). Same
 * key always yields the same hue, so a project's color stays stable across renders/sessions. */
export function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 55% 55%)`;
}
