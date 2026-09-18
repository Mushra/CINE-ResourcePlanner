import { describe, expect, it } from 'vitest';
import { deriveProjectStatus } from '../src/domain/projectStatus';
import { project } from './fixtures';

describe('deriveProjectStatus', () => {
  it('derives planned when today is before the start date', () => {
    const p = project({ status: 'planned', startDate: '2026-10-01', endDate: '2026-12-31' });
    expect(deriveProjectStatus(p, '2026-09-01')).toBe('planned');
  });

  it('derives planned when neither date is set', () => {
    const p = project({ status: 'planned', startDate: null, endDate: null });
    expect(deriveProjectStatus(p, '2026-09-01')).toBe('planned');
  });

  it('derives active when today falls within the date range', () => {
    const p = project({ status: 'planned', startDate: '2026-09-01', endDate: '2026-12-31' });
    expect(deriveProjectStatus(p, '2026-10-15')).toBe('active');
  });

  it('derives completed when today is after the end date', () => {
    const p = project({ status: 'active', startDate: '2026-01-01', endDate: '2026-06-30' });
    expect(deriveProjectStatus(p, '2026-09-01')).toBe('completed');
  });

  it('lets a manual on_hold override win over the dates', () => {
    const p = project({ status: 'on_hold', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(deriveProjectStatus(p, '2026-09-01')).toBe('on_hold');
  });

  it('lets a manual cancelled override win over the dates', () => {
    const p = project({ status: 'cancelled', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(deriveProjectStatus(p, '2026-09-01')).toBe('cancelled');
  });

  it('regression: a stale stored status never wins over dates for the auto-derived states', () => {
    // Stored field is frozen at whatever it was on last save (e.g. "planned"), but the dates now
    // say the project is active — the derived value must reflect the dates, not the stale field.
    const p = project({ status: 'planned', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(deriveProjectStatus(p, '2026-09-01')).toBe('active');
  });
});
