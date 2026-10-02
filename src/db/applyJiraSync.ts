// Writes confirmed Jira bindings (see src/domain/jiraBinding.ts for how they were proposed) into
// exactly one Project — same non-negotiable scoping rule as applyMppImport.ts: a jiraKey already
// claimed by a Cinematic/LOQ under a *different* project is never reassigned, only skipped with a
// warning. Signal-only for the plan's own fields: this never writes loqs.status or any committed/
// forecast date — Jira never silently overwrites the plan (see docs/INTEGRATIONS.md §3). The one
// structural exception is dependencies: Jira "Blocks" issue links are mirrored into loq_dependencies
// as source='jira' edges (full-replaced every sync), never touching user/template-owned edges.
// Date/status comparison lives in the jira_inconsistency sanity check instead.
import type { PlannerDatabase } from './database';
import { loadPlanningData, replaceCinematicRelatedIssues, replaceJiraLoqDependencies, updateCinematic, updateLoq, upsertCinematicJiraSyncState, upsertJiraSyncState } from './repository';
import type { NormalizedJiraBatch } from '../import/jiraSync';
import { DEFAULT_HOTLINE_LABEL, resolveRelatedIssuesByCinematic } from '../domain/relatedIssues';
import { wouldCreateCycle } from '../domain/loqGraph';
import type { DependencyType, LoqDependency } from '../domain/types';

/** Jira link-type name (case-insensitive) that maps to a scheduling dependency. The outward side
 * ("blocking") is the predecessor, the inward side ("is blocked by") the successor. */
const BLOCKS_LINK_TYPE = 'blocks';

/** cinematicId/loqId -> confirmed Jira key, or null for "don't link" (a proposal the user rejected). */
export interface ConfirmedJiraBindings {
  cinematics: Record<string, string | null>;
  loqs: Record<string, string | null>;
}

export interface JiraApplyReport {
  cinematicsLinked: number;
  cinematicsSkippedOtherProject: number;
  loqsLinked: number;
  loqsSkippedOtherProject: number;
  relatedIssuesLinked: number;
  /** source='jira' dependency edges inserted this sync (after de-dup, cycle and collision skips). */
  dependenciesLinked: number;
  /** Jira "Blocks" edges dropped because they'd close a cycle in the dependency DAG. */
  dependenciesSkippedCycle: number;
  warnings: string[];
}

export function applyJiraBindings(
  db: PlannerDatabase,
  batch: NormalizedJiraBatch,
  targetProjectId: string,
  confirmed: ConfirmedJiraBindings,
  hotlineLabel: string = DEFAULT_HOTLINE_LABEL,
): JiraApplyReport {
  const data = loadPlanningData(db);
  const warnings: string[] = [];
  const report: JiraApplyReport = {
    cinematicsLinked: 0,
    cinematicsSkippedOtherProject: 0,
    loqsLinked: 0,
    loqsSkippedOtherProject: 0,
    relatedIssuesLinked: 0,
    dependenciesLinked: 0,
    dependenciesSkippedCycle: 0,
    warnings,
  };

  const issueByKey = new Map(batch.issues.map((issue) => [issue.key, issue]));
  const cinematicById = new Map(data.cinematics.map((c) => [c.id, c]));
  const loqById = new Map(data.loqs.map((l) => [l.id, l]));

  // Collision guards: a jiraKey already sitting on a *different* row must never be reassigned here.
  const cinematicIdByJiraKey = new Map<string, string>();
  for (const c of data.cinematics) if (c.jiraKey) cinematicIdByJiraKey.set(c.jiraKey, c.id);
  const loqIdByJiraKey = new Map<string, string>();
  for (const l of data.loqs) if (l.jiraKey) loqIdByJiraKey.set(l.jiraKey, l.id);

  for (const [cinematicId, jiraKey] of Object.entries(confirmed.cinematics)) {
    if (!jiraKey) continue; // "don't link" or already unset — nothing to do
    const cinematic = cinematicById.get(cinematicId);
    if (!cinematic) continue;
    if (cinematic.projectId !== targetProjectId) {
      report.cinematicsSkippedOtherProject++;
      warnings.push(`Skipped linking ${jiraKey} to "${cinematic.name}" — it belongs to a different project.`);
      continue;
    }
    const collidingId = cinematicIdByJiraKey.get(jiraKey);
    if (collidingId && collidingId !== cinematicId) {
      report.cinematicsSkippedOtherProject++;
      warnings.push(`Skipped ${jiraKey} — it is already linked to a different Cinematic.`);
      continue;
    }
    const cinematicIssue = issueByKey.get(jiraKey);
    if (!cinematicIssue) {
      warnings.push(`Skipped ${jiraKey} — it was not found in the fetched Jira batch.`);
      continue;
    }
    if (cinematic.jiraKey !== jiraKey) updateCinematic(db, { ...cinematic, jiraKey });
    // Snapshot the linked epic's status so checkCinematicEpicDivergence can compare it against the
    // LOQ status rollup. Signal-only, same as the LOQ sync state — never written back to the plan.
    upsertCinematicJiraSyncState(db, {
      cinematicId,
      jiraStatus: cinematicIssue.status,
      jiraUpdatedAt: cinematicIssue.updatedAt,
      lastSyncedAt: new Date().toISOString(),
      rawSnapshot: JSON.stringify(cinematicIssue),
    });
    report.cinematicsLinked++;
  }

  for (const [loqId, jiraKey] of Object.entries(confirmed.loqs)) {
    if (!jiraKey) continue;
    const loq = loqById.get(loqId);
    if (!loq) continue;
    const cinematic = cinematicById.get(loq.cinematicId);
    if (!cinematic || cinematic.projectId !== targetProjectId) {
      report.loqsSkippedOtherProject++;
      warnings.push(`Skipped linking ${jiraKey} to a LOQ — it belongs to a different project.`);
      continue;
    }
    const collidingId = loqIdByJiraKey.get(jiraKey);
    if (collidingId && collidingId !== loqId) {
      report.loqsSkippedOtherProject++;
      warnings.push(`Skipped ${jiraKey} — it is already linked to a different LOQ.`);
      continue;
    }
    const issue = issueByKey.get(jiraKey);
    if (!issue) {
      warnings.push(`Skipped ${jiraKey} — it was not found in the fetched Jira batch.`);
      continue;
    }
    if (loq.jiraKey !== jiraKey) updateLoq(db, { ...loq, jiraKey });
    upsertJiraSyncState(db, {
      loqId,
      jiraStatus: issue.status,
      jiraAssignee: issue.assignee,
      jiraUpdatedAt: issue.updatedAt,
      lastSyncedAt: new Date().toISOString(),
      rawSnapshot: JSON.stringify(issue),
    });
    report.loqsLinked++;
  }

  // Hotlines/QA-bugs for the Cinematic detail widgets: derive them from the full batch (which holds
  // both a sub-task hotline and its parent, so parent-based association resolves entirely here) and
  // replace each target-project Cinematic's stored set. Signal-only, like the sync states above.
  const targetCinematics = data.cinematics.filter((c) => c.projectId === targetProjectId);
  const syncedAt = new Date().toISOString();
  const relatedByCinematic = resolveRelatedIssuesByCinematic(batch, targetCinematics, hotlineLabel, syncedAt);
  for (const cinematic of targetCinematics) {
    const related = relatedByCinematic.get(cinematic.id) ?? [];
    replaceCinematicRelatedIssues(db, cinematic.id, related);
    report.relatedIssuesLinked += related.length;
  }

  // Dependencies: mirror the Jira "Blocks" graph into source='jira' edges. Re-read the plan so the
  // jiraKey→loqId map reflects exactly what the binding loops just committed (skipped collisions
  // included, since those LOQs never got a key). Both endpoints must resolve to a LOQ in THIS
  // project; cross-project or unbound ends are dropped. Full-replace via replaceJiraLoqDependencies.
  const bound = loadPlanningData(db);
  const projectCinematicIds = new Set(bound.cinematics.filter((c) => c.projectId === targetProjectId).map((c) => c.id));
  const loqIdByKeyInProject = new Map<string, string>();
  for (const l of bound.loqs) {
    if (l.jiraKey && projectCinematicIds.has(l.cinematicId)) loqIdByKeyInProject.set(l.jiraKey, l.id);
  }

  // Cycle-guard against the surviving non-jira edges (the jira ones are about to be replaced).
  const accumulator = bound.loqDependencies
    .filter((d) => d.source !== 'jira')
    .map((d) => ({ predecessorLoqId: d.predecessorLoqId, successorLoqId: d.successorLoqId }));
  const seen = new Set<string>();
  const jiraEdges: Pick<LoqDependency, 'predecessorLoqId' | 'successorLoqId' | 'type' | 'lagDays'>[] = [];
  const FINISH_TO_START: DependencyType = 'finish_to_start';
  for (const issue of batch.issues) {
    const selfLoqId = loqIdByKeyInProject.get(issue.key);
    if (!selfLoqId) continue;
    for (const link of issue.issueLinks ?? []) {
      if (link.typeName.toLowerCase() !== BLOCKS_LINK_TYPE) continue;
      const otherLoqId = loqIdByKeyInProject.get(link.key);
      if (!otherLoqId) continue;
      const predecessorLoqId = link.direction === 'outward' ? selfLoqId : otherLoqId;
      const successorLoqId = link.direction === 'outward' ? otherLoqId : selfLoqId;
      if (predecessorLoqId === successorLoqId) continue;
      const pair = `${predecessorLoqId}::${successorLoqId}`;
      if (seen.has(pair)) continue; // same edge seen from the other issue's inward link
      if (wouldCreateCycle(accumulator, predecessorLoqId, successorLoqId)) {
        report.dependenciesSkippedCycle++;
        continue;
      }
      seen.add(pair);
      accumulator.push({ predecessorLoqId, successorLoqId });
      jiraEdges.push({ predecessorLoqId, successorLoqId, type: FINISH_TO_START, lagDays: 0 });
    }
  }
  report.dependenciesLinked = replaceJiraLoqDependencies(db, jiraEdges);

  return report;
}
