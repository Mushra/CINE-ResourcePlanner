import type { Project, ProjectStatus } from './types';

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned', active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled',
};

export function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type StatusDerivationInput = Pick<Project, 'status' | 'startDate' | 'endDate'>;

/**
 * Active/Planned/Completed are derived live from the project's dates — there is no "stale" status
 * to worry about. Cancelled and On hold are manual overrides that always win over the dates.
 */
export function deriveProjectStatus(project: StatusDerivationInput, todayIso: string = localTodayIso()): ProjectStatus {
  if (project.status === 'cancelled') return 'cancelled';
  if (project.status === 'on_hold') return 'on_hold';
  if (!project.startDate && !project.endDate) return 'planned';
  if (project.startDate && todayIso < project.startDate) return 'planned';
  if (project.endDate && todayIso > project.endDate) return 'completed';
  return 'active';
}
