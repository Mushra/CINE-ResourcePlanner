import { describe, expect, it } from 'vitest';
import { getCinematicDisciplineRollup, loqDemandPeriods, loqEffectiveFinish } from '../src/engine/loqRollup';
import { discipline, loq, loqResource } from './fixtures';

const CINE = 'cine-1';

function find(lines: ReturnType<typeof getCinematicDisciplineRollup>, disciplineId: string) {
  return lines.find((l) => l.disciplineId === disciplineId);
}

describe('getCinematicDisciplineRollup — demand, single month', () => {
  it('applies estimateDays / workingDaysInWindow to the touched month, 0 elsewhere', () => {
    const anim = discipline({ name: 'Animation' });
    // 2026-09-01 (Tue) .. 2026-09-15 (Tue) = 11 working days.
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-01', committedFinish: '2026-09-15', estimateDays: 5.5 });

    const inMonth = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-09');
    expect(find(inMonth, anim.id)?.demand).toBe(0.5);

    const outOfMonth = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-08');
    expect(find(outOfMonth, anim.id)?.demand).toBe(0);
  });
});

describe('getCinematicDisciplineRollup — demand spans 2 months, no proration', () => {
  it('carries the identical flat intensity in both the first and last month touched', () => {
    const anim = discipline({ name: 'Animation' });
    // 2026-09-21 (Mon) .. 2026-10-09 (Fri) = exactly 3 weeks = 15 working days.
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-21', committedFinish: '2026-10-09', estimateDays: 7.5 });

    const sep = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-09');
    const oct = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-10');
    expect(find(sep, anim.id)?.demand).toBe(0.5);
    expect(find(oct, anim.id)?.demand).toBe(0.5); // same intensity, not split/prorated across the two months

    const aug = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-08');
    const nov = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-11');
    expect(find(aug, anim.id)?.demand).toBe(0);
    expect(find(nov, anim.id)?.demand).toBe(0);
  });
});

describe('getCinematicDisciplineRollup — demand, implicit finish', () => {
  it('derives the finish as committedStart + estimateDays working days when committedFinish is null', () => {
    const anim = discipline({ name: 'Animation' });
    // 2026-09-01 (Tue) + 5 working days => 2026-09-07 (Mon); 5 working days in that span => intensity 1.0.
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-01', committedFinish: null, estimateDays: 5 });

    const sep = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-09');
    expect(find(sep, anim.id)?.demand).toBe(1);

    const oct = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-10');
    expect(find(oct, anim.id)?.demand).toBe(0); // implicit finish stays within September
  });
});

describe('getCinematicDisciplineRollup — demand, 0 cases', () => {
  it('is 0 when estimateDays is null even with committed dates', () => {
    const anim = discipline({ name: 'Animation' });
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-01', committedFinish: '2026-09-15', estimateDays: null });
    const lines = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-09');
    expect(find(lines, anim.id)?.demand).toBe(0);
  });

  it('is 0 when committedStart is null, regardless of estimateDays', () => {
    const anim = discipline({ name: 'Animation' });
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: null, committedFinish: null, estimateDays: 5 });
    const lines = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-09');
    expect(find(lines, anim.id)?.demand).toBe(0);
  });
});

describe('getCinematicDisciplineRollup — assigned, single window', () => {
  it('is the flat fte inside the window, 0 outside it', () => {
    const anim = discipline({ name: 'Animation' });
    const l = loq({ cinematicId: CINE, disciplineId: anim.id });
    const r = loqResource({ loqId: l.id, startDate: '2026-09-05', finishDate: '2026-09-20', fte: 0.75 });

    const inMonth = getCinematicDisciplineRollup(CINE, [l], [r], [anim], '2026-09');
    expect(find(inMonth, anim.id)?.assigned).toBe(0.75);

    const outOfMonth = getCinematicDisciplineRollup(CINE, [l], [r], [anim], '2026-08');
    expect(find(outOfMonth, anim.id)?.assigned).toBe(0);
  });
});

describe('getCinematicDisciplineRollup — assigned, Safehouse shape (two disjoint windows)', () => {
  it('carries each window\'s own fte in its own months, with 0 in the gap between them', () => {
    // Mirrors the real reference example (CIA_Safehouse-Anim-L2, NEW-OVR-MACRO-RELEASE-27.mpp):
    // Armand Rabuel ~100% 2025-05-26..2025-07-04, then Damien Contreras ~15% 2026-03-02..2026-06-26,
    // with an ~8-month gap between the two windows.
    const anim = discipline({ name: 'Animation' });
    const l = loq({ cinematicId: CINE, disciplineId: anim.id });
    const window1 = loqResource({ loqId: l.id, startDate: '2025-05-26', finishDate: '2025-07-04', fte: 1 });
    const window2 = loqResource({ loqId: l.id, startDate: '2026-03-02', finishDate: '2026-06-26', fte: 0.15 });
    const resources = [window1, window2];

    expect(find(getCinematicDisciplineRollup(CINE, [l], resources, [anim], '2025-05'), anim.id)?.assigned).toBe(1);
    expect(find(getCinematicDisciplineRollup(CINE, [l], resources, [anim], '2025-06'), anim.id)?.assigned).toBe(1);
    expect(find(getCinematicDisciplineRollup(CINE, [l], resources, [anim], '2025-07'), anim.id)?.assigned).toBe(1);
    expect(find(getCinematicDisciplineRollup(CINE, [l], resources, [anim], '2025-08'), anim.id)?.assigned).toBe(0);
    expect(find(getCinematicDisciplineRollup(CINE, [l], resources, [anim], '2026-01'), anim.id)?.assigned).toBe(0);
    expect(find(getCinematicDisciplineRollup(CINE, [l], resources, [anim], '2026-03'), anim.id)?.assigned).toBe(0.15);
    expect(find(getCinematicDisciplineRollup(CINE, [l], resources, [anim], '2026-06'), anim.id)?.assigned).toBe(0.15);
  });
});

describe('getCinematicDisciplineRollup — assigned, window-less row', () => {
  it('contributes 0 rather than spreading over the LOQ\'s committed window', () => {
    const anim = discipline({ name: 'Animation' });
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-01', committedFinish: '2026-09-30' });
    const r = loqResource({ loqId: l.id, startDate: null, finishDate: null, fte: 1 });

    const lines = getCinematicDisciplineRollup(CINE, [l], [r], [anim], '2026-09');
    expect(find(lines, anim.id)?.assigned).toBe(0);
  });
});

describe('getCinematicDisciplineRollup — discipline grouping', () => {
  it('keeps different disciplines on separate lines, sums same-discipline LOQs, sorts by name', () => {
    const zebra = discipline({ name: 'Zebra Discipline' });
    const anim = discipline({ name: 'Animation' });

    const loqAnim1 = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-01', committedFinish: '2026-09-10', estimateDays: 4 });
    const loqAnim2 = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-01', committedFinish: '2026-09-10', estimateDays: 2 });
    const loqZebra = loq({ cinematicId: CINE, disciplineId: zebra.id, committedStart: '2026-09-01', committedFinish: '2026-09-10', estimateDays: 1 });

    const lines = getCinematicDisciplineRollup(CINE, [loqAnim1, loqAnim2, loqZebra], [], [anim, zebra], '2026-09');

    expect(lines.map((l) => l.disciplineName)).toEqual(['Animation', 'Zebra Discipline']);
    const animLine = find(lines, anim.id)!;
    const zebraLine = find(lines, zebra.id)!;
    expect(animLine.demand).toBe(round2Sum(loqAnim1, loqAnim2)); // two same-discipline LOQs summed
    expect(zebraLine.demand).toBeGreaterThan(0);
  });

  it('excludes LOQs from other cinematics', () => {
    const anim = discipline({ name: 'Animation' });
    const mine = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-01', committedFinish: '2026-09-10', estimateDays: 4 });
    const other = loq({ cinematicId: 'cine-other', disciplineId: anim.id, committedStart: '2026-09-01', committedFinish: '2026-09-10', estimateDays: 100 });

    const lines = getCinematicDisciplineRollup(CINE, [mine, other], [], [anim], '2026-09');
    expect(lines).toHaveLength(1);
  });
});

describe('loqDemandPeriods', () => {
  it('returns every month a committed window touches, spanning multiple LOQs', () => {
    const l1 = loq({ committedStart: '2026-09-01', committedFinish: '2026-09-10', estimateDays: 4 });
    const l2 = loq({ committedStart: '2026-11-05', committedFinish: '2026-11-20', estimateDays: 3 });
    expect(loqDemandPeriods([l1, l2])).toEqual(['2026-09', '2026-11']);
  });

  it('derives the implicit finish (working days) when committedFinish is null', () => {
    // 2026-09-01 (Tue) + 5 working days => 2026-09-07 (Mon), still within September.
    const l1 = loq({ committedStart: '2026-09-01', committedFinish: null, estimateDays: 5 });
    expect(loqDemandPeriods([l1])).toEqual(['2026-09']);
  });

  it('skips a LOQ that cannot be placed (no committedStart, or no estimateDays with no committedFinish)', () => {
    const noStart = loq({ committedStart: null, committedFinish: null, estimateDays: 5 });
    const noFinishNoEstimate = loq({ committedStart: '2026-09-01', committedFinish: null, estimateDays: null });
    expect(loqDemandPeriods([noStart, noFinishNoEstimate])).toEqual([]);
  });

  it('dedupes and sorts across overlapping/out-of-order LOQs', () => {
    const l1 = loq({ committedStart: '2026-10-01', committedFinish: '2026-10-31', estimateDays: 20 });
    const l2 = loq({ committedStart: '2026-09-15', committedFinish: '2026-10-15', estimateDays: 20 });
    expect(loqDemandPeriods([l1, l2])).toEqual(['2026-09', '2026-10']);
  });
});

describe('loqEffectiveFinish — implicit finish from a (possibly fractional) estimate', () => {
  // 2026-09-07 is a Monday, 2026-09-04 a Friday, 2026-09-05/06 the weekend.
  const finishOf = (committedStart: string, estimateDays: number) =>
    loqEffectiveFinish(loq({ committedStart, committedFinish: null, estimateDays }));

  it('rounds a fractional estimate up to the working day that contains the finish', () => {
    expect(finishOf('2026-09-07', 0.5)).toBe('2026-09-07'); // 0.5d Mon → Mon
    expect(finishOf('2026-09-07', 1.5)).toBe('2026-09-08'); // 1.5d Mon → Tue
    expect(finishOf('2026-09-04', 1.5)).toBe('2026-09-07'); // 1.5d Fri → Mon (skips the weekend)
  });

  it('keeps the integer-estimate behaviour (start inclusive, Mon–Fri)', () => {
    expect(finishOf('2026-09-07', 1)).toBe('2026-09-07');  // 1d Mon → Mon
    expect(finishOf('2026-09-07', 5)).toBe('2026-09-11');  // 5d Mon → Fri
    expect(finishOf('2026-09-07', 10)).toBe('2026-09-18'); // 10d Mon → Fri of the next week
  });

  it('starts counting on the Monday after a weekend start with a positive duration', () => {
    expect(finishOf('2026-09-05', 0.5)).toBe('2026-09-07'); // Sat + 0.5d → Mon
    expect(finishOf('2026-09-05', 1)).toBe('2026-09-07');   // Sat + 1d   → Mon
    expect(finishOf('2026-09-05', 1.5)).toBe('2026-09-08'); // Sat + 1.5d → Tue
    expect(finishOf('2026-09-06', 1)).toBe('2026-09-07');   // Sun + 1d   → Mon
  });

  it('keeps the start date for a zero estimate (even on a weekend)', () => {
    expect(finishOf('2026-09-07', 0)).toBe('2026-09-07');
    expect(finishOf('2026-09-05', 0)).toBe('2026-09-05');
  });

  it('yields null — not a hang or a throw — for negative, NaN, Infinity and absurdly large estimates', () => {
    expect(finishOf('2026-09-07', -3)).toBeNull();
    expect(finishOf('2026-09-07', Number.NaN)).toBeNull();
    expect(finishOf('2026-09-07', Number.POSITIVE_INFINITY)).toBeNull();
    expect(finishOf('2026-09-07', 1e9)).toBeNull(); // overflows the Date range → no usable finish
    expect(finishOf('2026-09-07', Number.MAX_VALUE)).toBeNull();
  });

  it('yields null for an invalid or impossible start date', () => {
    expect(finishOf('not-a-date', 5)).toBeNull();
    expect(finishOf('2026-13-45', 5)).toBeNull();
    expect(finishOf('2026-02-30', 1.5)).toBeNull();
  });

  it('still honours an explicit committedFinish over the estimate', () => {
    expect(loqEffectiveFinish(loq({ committedStart: '2026-09-07', committedFinish: '2026-09-30', estimateDays: 1.5 }))).toBe('2026-09-30');
  });

  it('terminates at once on a fractional estimate (the old integer loop never reached count === 1.5)', () => {
    const start = Date.now();
    expect(finishOf('2026-09-07', 1.5)).toBe('2026-09-08');
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('loqEffectiveFinish — a huge estimate yields no window, never a malformed date', () => {
  it('returns null for a multi-million-day estimate rather than an expanded-year string like "+013525-12"', () => {
    // Exact repro: start 2026-10-05, no explicit finish, estimate 3,000,000 days. The derived finish
    // lands in year ~13525, whose toISOString serialises as "+013525-12-…", not yyyy-mm-dd.
    const finish = loqEffectiveFinish(loq({ committedStart: '2026-10-05', committedFinish: null, estimateDays: 3_000_000 }));
    expect(finish).toBeNull();
  });

  it('an in-range estimate still derives a normal yyyy-mm-dd finish', () => {
    const finish = loqEffectiveFinish(loq({ committedStart: '2026-10-05', committedFinish: null, estimateDays: 5 }));
    expect(finish).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getCinematicDisciplineRollup — an invalid estimate never contaminates demand, even with an explicit finish', () => {
  const anim = discipline({ name: 'Animation' });

  it('a NaN estimate with an explicit committedFinish yields 0 demand, not NaN', () => {
    // Exact repro: start 2026-10-05, explicit finish 2026-10-06, estimate NaN. With a committedFinish
    // the old guard (estimateDays == null) didn't catch NaN, so NaN/days propagated into the rollup.
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-10-05', committedFinish: '2026-10-06', estimateDays: Number.NaN });
    const demand = find(getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-10'), anim.id)?.demand;
    expect(demand).toBe(0);
    expect(Number.isNaN(demand)).toBe(false);
  });

  it('a negative estimate with an explicit committedFinish yields 0 demand, not a negative number', () => {
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-10-05', committedFinish: '2026-10-30', estimateDays: -5 });
    const demand = find(getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-10'), anim.id)?.demand ?? 0;
    expect(demand).toBe(0);
  });

  it('an Infinity estimate with an explicit committedFinish yields 0 demand', () => {
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-10-05', committedFinish: '2026-10-30', estimateDays: Number.POSITIVE_INFINITY });
    const demand = find(getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-10'), anim.id)?.demand;
    expect(demand).toBe(0);
  });

  it('a valid fractional estimate is still honoured alongside an explicit finish (regression guard)', () => {
    // 2026-09-01 (Tue) .. 2026-09-15 (Tue) = 11 working days; 5.5 / 11 = 0.5.
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-01', committedFinish: '2026-09-15', estimateDays: 5.5 });
    expect(find(getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-09'), anim.id)?.demand).toBe(0.5);
  });
});

describe('getCinematicDisciplineRollup — fractional estimate, implicit finish', () => {
  it('preserves the fractional estimate in the demand intensity (1.5 over a 2-day window → 0.75, not 1)', () => {
    const anim = discipline({ name: 'Animation' });
    // Mon 2026-09-07 + 1.5 working days → Tue 2026-09-08; 2 working days in [Mon,Tue] → 1.5 / 2.
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-07', committedFinish: null, estimateDays: 1.5 });
    const sep = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-09');
    expect(find(sep, anim.id)?.demand).toBe(0.75);
  });

  it('contributes no demand when the estimate yields no derivable finish', () => {
    const anim = discipline({ name: 'Animation' });
    const l = loq({ cinematicId: CINE, disciplineId: anim.id, committedStart: '2026-09-07', committedFinish: null, estimateDays: -4 });
    const sep = getCinematicDisciplineRollup(CINE, [l], [], [anim], '2026-09');
    expect(find(sep, anim.id)?.demand).toBe(0);
  });

  it('loqDemandPeriods terminates and returns the touched month for a fractional, finish-less LOQ', () => {
    const l = loq({ committedStart: '2026-09-07', committedFinish: null, estimateDays: 1.5 });
    expect(loqDemandPeriods([l])).toEqual(['2026-09']);
  });
});

// Helper for the grouping test: both LOQs share the same committed window, so their demand
// intensities (estimateDays / same workingDays count) simply add.
function round2Sum(a: { estimateDays: number | null }, b: { estimateDays: number | null }): number {
  const days = 8; // 2026-09-01 (Tue) .. 2026-09-10 (Thu) = 8 working days
  const value = (a.estimateDays ?? 0) / days + (b.estimateDays ?? 0) / days;
  return Math.round(value * 100) / 100;
}
