import { round2 } from '../../engine/planning';

export function formatNum(n: number): string {
  const r = round2(n);
  return r === Math.trunc(r) ? String(r) : r.toFixed(1);
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const bigint = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
