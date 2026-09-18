import { describe, expect, it } from 'vitest';
import { getCinematicDisciplineRollup } from '../src/engine/loqRollup';
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

// Helper for the grouping test: both LOQs share the same committed window, so their demand
// intensities (estimateDays / same workingDays count) simply add.
function round2Sum(a: { estimateDays: number | null }, b: { estimateDays: number | null }): number {
  const days = 8; // 2026-09-01 (Tue) .. 2026-09-10 (Thu) = 8 working days
  const value = (a.estimateDays ?? 0) / days + (b.estimateDays ?? 0) / days;
  return Math.round(value * 100) / 100;
}
