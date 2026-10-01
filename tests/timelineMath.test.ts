import { describe, expect, it } from 'vitest';
import {
  fineAxisTicks, fitZoomForWidth, formatIsoDateShort, isoAddMonths, monthWindowForIsoRange,
  pxPerDayForZoom, timelineGranularity, zoomAfterWheel,
} from '../src/ui/timeline/timelineMath';
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

describe('pxPerDayForZoom', () => {
  it('maps 100% to the 3px/day base scale and scales linearly', () => {
    expect(pxPerDayForZoom(100)).toBe(3);
    expect(pxPerDayForZoom(200)).toBe(6);
    expect(pxPerDayForZoom(600)).toBe(18); // day-granularity threshold
    expect(pxPerDayForZoom(10)).toBeCloseTo(0.3);
  });
});

describe('fitZoomForWidth', () => {
  it('returns the zoom that makes the span exactly fill the width', () => {
    // 100 days should fill 600px at 6px/day => zoom 200%.
    expect(fitZoomForWidth(600, 100, { min: 10, max: 800 })).toBeCloseTo(200);
  });

  it('clamps to max when the span is tiny (would need to zoom past the ceiling)', () => {
    expect(fitZoomForWidth(2000, 5, { min: 10, max: 800 })).toBe(800);
  });

  it('clamps to min when the span is huge (would need to zoom below the floor)', () => {
    expect(fitZoomForWidth(300, 100000, { min: 10, max: 800 })).toBe(10);
  });

  it('stays in range for a zero/unknown width (pre-layout)', () => {
    expect(fitZoomForWidth(0, 100, { min: 10, max: 800 })).toBe(10);
  });

  it('returns max for a non-positive span', () => {
    expect(fitZoomForWidth(600, 0, { min: 10, max: 800 })).toBe(800);
  });
});

describe('zoomAfterWheel', () => {
  it('zooms in on an upward (negative deltaY) scroll and clamps to the range', () => {
    expect(zoomAfterWheel(100, -50, { min: 10, max: 800 })).toBe(110);
    expect(zoomAfterWheel(790, -200, { min: 10, max: 800 })).toBe(800);
    expect(zoomAfterWheel(20, 200, { min: 10, max: 800 })).toBe(10);
  });
});

describe('monthWindowForIsoRange', () => {
  it('spans every month touched by the ISO range, inclusive', () => {
    // first LOQ 2026-09-07 padded -14d => 2026-08-24; last finish 2026-11-05 padded +14d => 2026-11-19.
    expect(monthWindowForIsoRange('2026-08-24', '2026-11-19')).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
  });

  it('collapses to a single month when the padded range stays within it', () => {
    expect(monthWindowForIsoRange('2026-09-05', '2026-09-20')).toEqual(['2026-09']);
  });

  it('is empty when the range is inverted', () => {
    expect(monthWindowForIsoRange('2026-11-01', '2026-09-01')).toEqual([]);
  });
});

describe('isoAddMonths', () => {
  it('adds whole calendar months', () => {
    expect(isoAddMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(isoAddMonths('2026-09-28', 4)).toBe('2027-01-28');
  });

  it('rolls over the year boundary', () => {
    expect(isoAddMonths('2026-11-10', 4)).toBe('2027-03-10');
  });

  it('clamps the day to the target month\'s last day', () => {
    expect(isoAddMonths('2026-01-31', 1)).toBe('2026-02-28'); // Feb has 28 days in 2026
    expect(isoAddMonths('2028-01-31', 1)).toBe('2028-02-29'); // 2028 is a leap year
  });
});
