import { describe, expect, it } from 'vitest';
import { fineAxisTicks, formatIsoDateShort, timelineGranularity } from '../src/ui/timeline/timelineMath';
import type { Period } from '../src/domain/types';

describe('timelineGranularity', () => {
  it('steps month -> week -> day at the 7px/day and 18px/day thresholds', () => {
    expect(timelineGranularity(3)).toBe('month');
    expect(timelineGranularity(6.99)).toBe('month');
    expect(timelineGranularity(7)).toBe('week');
    expect(timelineGranularity(17.99)).toBe('week');
    expect(timelineGranularity(18)).toBe('day');
    expect(timelineGranularity(24)).toBe('day');
  });
});

describe('fineAxisTicks', () => {
  const window: Period[] = ['2026-04'];

  it('is empty at month granularity', () => {
    expect(fineAxisTicks(window, 'month')).toEqual([]);
  });

  it('day granularity produces one tick per calendar day of the window (April = 30)', () => {
    const ticks = fineAxisTicks(window, 'day');
    expect(ticks).toHaveLength(30);
    expect(ticks[0]).toBe('2026-04-01');
    expect(ticks[ticks.length - 1]).toBe('2026-04-30');
  });

  it('week granularity produces Monday-aligned ticks, 7 days apart, none before the window start', () => {
    const ticks = fineAxisTicks(window, 'week');
    expect(ticks.length).toBeGreaterThan(0);
    for (const iso of ticks) {
      expect(new Date(`${iso}T00:00:00Z`).getUTCDay()).toBe(1); // Monday
      expect(iso >= '2026-04-01').toBe(true);
      expect(iso < '2026-05-01').toBe(true);
    }
    for (let i = 1; i < ticks.length; i++) {
      const days = (Date.parse(`${ticks[i]}T00:00:00Z`) - Date.parse(`${ticks[i - 1]}T00:00:00Z`)) / 86400000;
      expect(days).toBe(7);
    }
  });

  it('returns [] for an empty window', () => {
    expect(fineAxisTicks([], 'day')).toEqual([]);
  });
});

describe('formatIsoDateShort', () => {
  it('renders day + short month, no year', () => {
    expect(formatIsoDateShort('2026-04-12')).toBe('Apr 12');
  });
});
