/** Deterministic color for entities that carry no `color` field of their own (e.g. Project). Same
 * key always yields the same hue, so a project's color stays stable across renders/sessions.
 * @deprecated Prefer `colorForProject`, which spreads hues by index instead of hashing — a hash
 * can put two keys' hues right next to each other, while a spread guarantees contrast. */
export function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 55% 55%)`;
}

/** Golden-angle hue spread: consecutive indices land maximally far apart in hue, so a whole
 * ordered set of entities (siblings at the same level) reads as visually distinct. */
export function spreadHue(index: number, sat = 55, light = 55): string {
  const hue = (Math.max(0, index) * 137.508) % 360;
  return `hsl(${hue.toFixed(1)} ${sat}% ${light}%)`;
}

/** Color for a project, spread by its position in a stable ordering (e.g. sortOrder then name)
 * rather than hashed — guarantees maximal contrast between sibling projects. */
export function colorForProject(projectId: string, orderedIds: string[]): string {
  const index = orderedIds.indexOf(projectId);
  return spreadHue(index < 0 ? 0 : index);
}

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Extracts the hue (0-360) from either a `#rrggbb` hex color or an `hsl(h s% l%)` string. */
function hueOf(color: string): number {
  if (color.startsWith('#')) return hexToHue(color);
  const match = color.match(/hsl\(\s*([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/** Picks the hue (out of `candidateCount` evenly-spaced options) with the greatest minimum
 * distance from every color already in use, so a newly-created sibling contrasts with them all. */
export function pickContrastingColor(existing: string[], candidateCount = 24): string {
  if (existing.length === 0) return spreadHue(0);
  const existingHues = existing.map(hueOf);
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < candidateCount; i++) {
    const hue = (i * 360) / candidateCount;
    const minDist = Math.min(...existingHues.map((h) => hueDistance(hue, h)));
    if (minDist > bestScore) {
      bestScore = minDist;
      best = hue;
    }
  }
  return `hsl(${best.toFixed(1)} 55% 55%)`;
}
