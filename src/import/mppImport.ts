// Parses the JSON emitted by java/MppToJson.java into plan-shaped data. Pure — no DB, no UI, no
// IPC. See docs/INTEGRATIONS.md for why these specific fields (Text1/Text2/Text3, parent task
// name, Work-vs-Duration) are the right ones — confirmed against a real production .mpp file, not
// guessed from the format spec. Mirrors rpmImport.ts's shape (Normalized*/Report DTOs feeding a
// separate apply step) but everything here is scoped to whichever Project the caller targets —
// see applyMppImport.ts, never this module, for that scoping.
import type { DependencyType } from '../domain/types';
import type { MppShimOutput, MppTaskJson } from '../types/mpp';

const HOURS_PER_DAY = 8;

const RELATION_TYPE: Record<string, DependencyType> = {
  FS: 'finish_to_start',
  SS: 'start_to_start',
  FF: 'finish_to_finish',
  SF: 'start_to_finish',
};

export interface NormalizedMppLoq {
  jiraKey: string;
  cinematicName: string;
  disciplineCode: string;
  type: string;
  estimateDays: number | null;
  start: string | null;
  finish: string | null;
}

export interface NormalizedMppDependency {
  predecessorJiraKey: string;
  successorJiraKey: string;
  type: DependencyType;
  lagDays: number;
}

export interface NormalizedMppResourceAssignment {
  jiraKey: string;
  personName: string;
  personGroup: string | null;
  start: string | null;
  finish: string | null;
  fte: number;
}

export interface NormalizedMppRosterEntry {
  name: string;
  group: string | null;
}

export interface MppImportReport {
  fileName?: string;
  totalNonSummaryTasks: number;
  importedLoqs: number;
  skippedNoJiraKey: number;
  skippedMissingDiscipline: number;
  disciplineCodes: string[];
  warnings: string[];
}

export interface NormalizedMppImport {
  loqs: NormalizedMppLoq[];
  dependencies: NormalizedMppDependency[];
  resources: NormalizedMppResourceAssignment[];
  roster: NormalizedMppRosterEntry[];
  report: MppImportReport;
}

export function parseMppJson(json: MppShimOutput, fileName?: string): NormalizedMppImport {
  const warnings: string[] = [];
  const disciplineCodes = new Set<string>();
  const loqs: NormalizedMppLoq[] = [];
  const resources: NormalizedMppResourceAssignment[] = [];
  const jiraKeyByUid = new Map<number, string>();
  let skippedMissingDiscipline = 0;

  for (const task of json.tasks) jiraKeyByUid.set(task.uid, task.jiraKey);

  for (const task of json.tasks) {
    if (!task.discipline) {
      skippedMissingDiscipline++;
      warnings.push(`Skipped ${task.jiraKey} ("${task.name}") — no discipline (Text1) in the source file.`);
      continue;
    }
    disciplineCodes.add(task.discipline);
    loqs.push({
      jiraKey: task.jiraKey,
      cinematicName: task.cinematicName?.trim() || task.name,
      disciplineCode: task.discipline,
      type: task.loqType ?? inferTypeFromName(task.name),
      estimateDays: estimateDaysFor(task),
      start: task.start,
      finish: task.finish,
    });
    for (const res of task.resources) {
      resources.push({
        jiraKey: task.jiraKey,
        personName: res.name,
        personGroup: res.group,
        start: res.start ?? task.start,
        finish: res.finish ?? task.finish,
        fte: res.units / 100,
      });
    }
  }

  const dependencies: NormalizedMppDependency[] = [];
  for (const task of json.tasks) {
    for (const pred of task.predecessors) {
      const predecessorJiraKey = jiraKeyByUid.get(pred.uid);
      if (!predecessorJiraKey) continue; // predecessor didn't pass the Jira-key filter — scaffolding, not a real LOQ edge
      dependencies.push({
        predecessorJiraKey,
        successorJiraKey: task.jiraKey,
        type: RELATION_TYPE[pred.type] ?? 'finish_to_start',
        lagDays: pred.lagDays,
      });
    }
  }

  const roster: NormalizedMppRosterEntry[] = json.resourceRoster.map((r) => ({ name: r.name, group: r.group }));

  const skippedNoJiraKey = json.totalNonSummaryTasks - json.tasks.length;
  return {
    loqs,
    dependencies,
    resources,
    roster,
    report: {
      fileName,
      totalNonSummaryTasks: json.totalNonSummaryTasks,
      importedLoqs: loqs.length,
      skippedNoJiraKey,
      skippedMissingDiscipline,
      disciplineCodes: [...disciplineCodes].sort(),
      warnings,
    },
  };
}

/** Work is populated for the disciplines that track effort in hours (Anim/Light/VFX in the
 * observed file, ~8h/day); many other leaf tasks carry Work=0 even with a real Duration —
 * fall back to Duration in that case rather than reporting a zero-day estimate. */
function estimateDaysFor(task: MppTaskJson): number | null {
  if (task.workHours && task.workHours > 0) return round1(task.workHours / HOURS_PER_DAY);
  return task.durationDays != null ? round1(task.durationDays) : null;
}

/** Text2 is null for some branches of the observed file (e.g. Previz tasks) even though the task
 * name still carries a stage suffix like "-Previz-C2" — recover it from the name rather than
 * leaving the LOQ typeless. Falls back to the discipline-suffixed tail, or "L0" as a last resort. */
function inferTypeFromName(name: string): string {
  const match = /-([A-Za-z0-9]+)\s*$/.exec(name);
  return match ? match[1] : 'L0';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
