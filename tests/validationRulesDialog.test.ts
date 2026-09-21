import { describe, expect, it } from 'vitest';
import { RULES } from '../src/ui/components/ValidationRulesDialog';
import type { CheckCategory } from '../src/engine/validation';

/**
 * ARCHITECTURE_AUDIT.md §8 flagged ValidationRulesDialog's RULES array as a hand-maintained mirror of
 * CheckCategory that can silently drift (it had: capacity_conflict_cinematic was implemented in
 * validation.ts but missing from RULES). The switch below only compiles if every CheckCategory member
 * is listed — TS's exhaustiveness check on the `never` default catches a category added to the type
 * but never listed here; the runtime assertion then catches RULES itself falling out of sync with
 * this list.
 */
function allCheckCategories(): CheckCategory[] {
  const categories: CheckCategory[] = [
    'over_capacity',
    'understaffed_project',
    'unstaffed_requirement',
    'invalid_dates',
    'tbd_dates',
    'available_not_assigned',
    'over_allocated',
    'assignment_without_requirement',
    'duration_mismatch',
    'unstaffed_person',
    'over_allocated_person',
    'capacity_conflict_cinematic',
    'loq_at_risk',
    'loq_root_cause',
    'loq_early_opportunity',
  ];
  for (const category of categories) {
    switch (category) {
      case 'over_capacity':
      case 'understaffed_project':
      case 'unstaffed_requirement':
      case 'invalid_dates':
      case 'tbd_dates':
      case 'available_not_assigned':
      case 'over_allocated':
      case 'assignment_without_requirement':
      case 'duration_mismatch':
      case 'unstaffed_person':
      case 'over_allocated_person':
      case 'capacity_conflict_cinematic':
      case 'loq_at_risk':
      case 'loq_root_cause':
      case 'loq_early_opportunity':
        break;
      default: {
        const exhaustive: never = category;
        return exhaustive;
      }
    }
  }
  return categories;
}

describe('ValidationRulesDialog RULES — stays in sync with CheckCategory', () => {
  it('has exactly one RuleDoc entry per CheckCategory value, no duplicates', () => {
    const expected = allCheckCategories();
    const actual = RULES.map((r) => r.category);
    expect(new Set(actual).size).toBe(actual.length);
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});
