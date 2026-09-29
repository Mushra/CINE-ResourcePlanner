// Classifies and associates Jira issues to Cinematics for the detail view's Hotlines/QA-bugs
// widgets. Pure — no DB, no UI, no network. A related issue is either a Hotline (carries the
// configured hotline label, e.g. "CINE_HOTLINE") or a QA bug (issuetype = Bug); it attaches to a
// Cinematic via the "Cinematics List" name it (or its parent, for NEO-style sub-tasks that lack the
// field) is tagged against. Signal-only — nothing here is ever written back to plan status/dates.
import { jiraMatchKey } from './jiraBinding';
import type { NormalizedJiraBatch, NormalizedJiraIssue } from '../import/jiraSync';
import type { Cinematic, CinematicRelatedIssue } from './types';

export type RelatedIssueKind = 'hotline' | 'bug';

export const DEFAULT_HOTLINE_LABEL = 'CINE_HOTLINE';

/** Hotline if the issue carries the hotline label (case-insensitive), else a bug if its type is
 * "Bug", else null (not a related issue). Hotline wins when an issue is both a labelled Bug — the
 * escalation framing is the more actionable one. */
export function classifyRelatedIssue(issue: NormalizedJiraIssue, hotlineLabel: string): RelatedIssueKind | null {
  const label = hotlineLabel.toLowerCase();
  if (issue.labels.some((l) => l.toLowerCase() === label)) return 'hotline';
  if (issue.issueType.toLowerCase() === 'bug') return 'bug';
  return null;
}

/**
 * Groups a batch's Hotline/QA-bug issues by the Cinematic they belong to. Association follows the
 * same "Cinematics List" name signal the binding cascade uses (matched accent/order-insensitively
 * via jiraMatchKey): an issue's own cinematicName, or — for a sub-task hotline that lacks the field
 * (the NEO case) — its parent issue's cinematicName, looked up within the same batch. Issues that
 * match no Cinematic in `cinematics` are dropped. `syncedAt` stamps every produced row.
 */
export function resolveRelatedIssuesByCinematic(
  batch: NormalizedJiraBatch,
  cinematics: Cinematic[],
  hotlineLabel: string,
  syncedAt: string,
): Map<string, CinematicRelatedIssue[]> {
  const cinematicIdByNameKey = new Map<string, string>();
  for (const c of cinematics) cinematicIdByNameKey.set(jiraMatchKey(c.name), c.id);

  const issueByKey = new Map(batch.issues.map((i) => [i.key, i]));
  const result = new Map<string, CinematicRelatedIssue[]>();

  for (const issue of batch.issues) {
    const kind = classifyRelatedIssue(issue, hotlineLabel);
    if (!kind) continue;

    // Own Cinematics List value, else the parent's (sub-task hotline without the field).
    const cinematicName = issue.cinematicName ?? (issue.parentKey ? issueByKey.get(issue.parentKey)?.cinematicName ?? null : null);
    if (!cinematicName) continue;
    const cinematicId = cinematicIdByNameKey.get(jiraMatchKey(cinematicName));
    if (!cinematicId) continue;

    const row: CinematicRelatedIssue = {
      cinematicId,
      jiraKey: issue.key,
      kind,
      summary: issue.summary || null,
      status: issue.status,
      issueType: issue.issueType,
      assignee: issue.assignee,
      updatedAt: issue.updatedAt,
      resolutionDate: issue.resolutionDate,
      lastSyncedAt: syncedAt,
    };
    const existing = result.get(cinematicId);
    if (existing) existing.push(row);
    else result.set(cinematicId, [row]);
  }

  return result;
}

/**
 * Builds the related-issue rows for a single Cinematic from a batch already scoped to it (the light
 * per-cinematic refresh — see useStore.refreshCinematicRelatedIssues). Because the query targeted
 * this Cinematic (by Cinematics List value and its already-known related keys), every classified
 * issue belongs to it, so this skips the name/parent association that the full-sync path needs —
 * which also avoids dropping known sub-task hotlines whose parent isn't in the narrow batch.
 */
export function relatedIssuesForCinematic(
  batch: NormalizedJiraBatch,
  cinematicId: string,
  hotlineLabel: string,
  syncedAt: string,
): CinematicRelatedIssue[] {
  const rows: CinematicRelatedIssue[] = [];
  for (const issue of batch.issues) {
    const kind = classifyRelatedIssue(issue, hotlineLabel);
    if (!kind) continue;
    rows.push({
      cinematicId,
      jiraKey: issue.key,
      kind,
      summary: issue.summary || null,
      status: issue.status,
      issueType: issue.issueType,
      assignee: issue.assignee,
      updatedAt: issue.updatedAt,
      resolutionDate: issue.resolutionDate,
      lastSyncedAt: syncedAt,
    });
  }
  return rows;
}
