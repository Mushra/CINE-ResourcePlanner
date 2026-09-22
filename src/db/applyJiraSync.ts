// Writes confirmed Jira bindings (see src/domain/jiraBinding.ts for how they were proposed) into
// exactly one Project — same non-negotiable scoping rule as applyMppImport.ts: a jiraKey already
// claimed by a Cinematic/LOQ under a *different* project is never reassigned, only skipped with a
// warning. Signal-only: this never writes loqs.status or any committed/forecast date — Jira never
// silently overwrites the plan (see docs/INTEGRATIONS.md §3). Date/status comparison lives in the
// jira_inconsistency sanity check instead.
import type { PlannerDatabase } from './database';
import { loadPlanningData, updateCinematic, updateLoq, upsertJiraSyncState } from './repository';
import type { NormalizedJiraBatch } from '../import/jiraSync';

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
  warnings: string[];
}

export function applyJiraBindings(
  db: PlannerDatabase,
  batch: NormalizedJiraBatch,
  targetProjectId: string,
  confirmed: ConfirmedJiraBindings,
): JiraApplyReport {
  const data = loadPlanningData(db);
  const warnings: string[] = [];
  const report: JiraApplyReport = {
    cinematicsLinked: 0,
    cinematicsSkippedOtherProject: 0,
    loqsLinked: 0,
    loqsSkippedOtherProject: 0,
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
    if (!issueByKey.has(jiraKey)) {
      warnings.push(`Skipped ${jiraKey} — it was not found in the fetched Jira batch.`);
      continue;
    }
    if (cinematic.jiraKey !== jiraKey) updateCinematic(db, { ...cinematic, jiraKey });
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

  return report;
}
