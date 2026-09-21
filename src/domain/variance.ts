/** PLANNING_ENGINE.md §4.1 — validated as-is (product owner, 2026-09-18). Drives the declare-variance
 * category select only; VarianceCategory itself stays `string` so this list can grow without a migration. */
export const VARIANCE_CATEGORIES = [
  { value: 'SICK_LEAVE_ABSENCE', label: 'Sick leave / absence' },
  { value: 'TECHNICAL_ISSUE', label: 'Technical issue' },
  { value: 'PRODUCTION_BLOCKER', label: 'Production blocker' },
  { value: 'CLIENT_DIRECTION_CHANGE', label: 'Client direction change' },
  { value: 'SCOPE_CHANGE', label: 'Scope change' },
  { value: 'EXTERNAL_DEPENDENCY', label: 'External dependency' },
  { value: 'WAITING_FOR_VALIDATION', label: 'Waiting for validation' },
  { value: 'RESOURCE_UNAVAILABLE', label: 'Resource unavailable' },
  { value: 'ESTIMATION_ISSUE', label: 'Estimation issue' },
  { value: 'PRIORITY_CHANGE', label: 'Priority change' },
  { value: 'OTHER', label: 'Other' },
] as const;
