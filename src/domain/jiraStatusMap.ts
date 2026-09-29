// Canonical LOQ-status vocabulary and the configurable Jira-status → canonical mapping.
//
// The plan owns a single 6-value status language (see LoqStatus in types.ts). A LOQ/Cinematic bound
// to a Jira issue *mirrors* that issue's status: its raw Jira status string is resolved through a
// per-project mapping into one of the canonical values. This module is pure — it never reads or
// writes anything; the effective status is derived on read (see engine/watchtower.ts), never stored
// (mirroring the app's "derive, never store" precedent), so editing the mapping updates every row
// live without re-syncing.
//
// `paused` is deliberately NOT a target here: it's the *voluntary* hold the planner sets by hand and
// Jira never drives it. `BLOCKED` is the *involuntary* status Jira can report.

import type { JiraProjectConfig, LoqStatus } from './types';
import { DEFAULT_HOTLINE_LABEL } from './relatedIssues';

/** All canonical statuses, best-known display order. */
export const CANONICAL_STATUSES: LoqStatus[] = ['TODO', 'IN_PROGRESS', 'TO_REVIEW', 'BLOCKED', 'DONE', 'CUT'];

export const CANONICAL_STATUS_LABEL: Record<LoqStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  TO_REVIEW: 'To review',
  BLOCKED: 'Blocked',
  DONE: 'Done',
  CUT: 'Cut',
};

/**
 * Sentinel for a bound issue whose raw Jira status isn't covered by the mapping — surfaced
 * explicitly as "À mapper" in the UI and as a sanity check, never silently defaulted to a status.
 */
export const UNMAPPED = 'unmapped' as const;
export type EffectiveStatus = LoqStatus | typeof UNMAPPED;

/**
 * Default raw-Jira-status → canonical mapping, seeded into every new/loaded config so the table is
 * fully populated and user-editable. Keys are matched case-insensitively and whitespace-trimmed
 * (see resolveJiraStatus), so they're stored lowercase here. Covers the common Server/DC workflow
 * vocabulary seen on the discovery-spike projects; per-instance custom statuses are added by the
 * user in Settings.
 */
export const DEFAULT_JIRA_STATUS_MAPPING: Record<string, LoqStatus> = {
  'to do': 'TODO', todo: 'TODO', open: 'TODO', backlog: 'TODO', new: 'TODO', reopened: 'TODO',
  'in progress': 'IN_PROGRESS', 'in dev': 'IN_PROGRESS', 'in development': 'IN_PROGRESS', doing: 'IN_PROGRESS',
  'in review': 'TO_REVIEW', 'ready for review': 'TO_REVIEW', 'code review': 'TO_REVIEW', qa: 'TO_REVIEW', 'in qa': 'TO_REVIEW', review: 'TO_REVIEW',
  'on hold': 'BLOCKED', blocked: 'BLOCKED', waiting: 'BLOCKED', 'waiting for': 'BLOCKED', impediment: 'BLOCKED', 'on hold / blocked': 'BLOCKED',
  done: 'DONE', closed: 'DONE', resolved: 'DONE', complete: 'DONE', completed: 'DONE',
  cancelled: 'CUT', canceled: 'CUT', "won't do": 'CUT', "won't fix": 'CUT', cut: 'CUT', rejected: 'CUT', 'not needed': 'CUT',
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Resolves a raw Jira status string to a canonical LoqStatus through `mapping` (case-insensitive,
 * trimmed). Returns null when the status is absent or not covered by the mapping — the caller treats
 * null as "unmapped / À mapper", never as a default status. Falls back to the built-in default map
 * only when `mapping` is null/empty (e.g. a legacy config that predates the normalizer).
 */
export function resolveJiraStatus(raw: string | null, mapping: Record<string, LoqStatus> | null | undefined): LoqStatus | null {
  if (!raw) return null;
  const key = norm(raw);
  const table = mapping && Object.keys(mapping).length > 0 ? mapping : DEFAULT_JIRA_STATUS_MAPPING;
  for (const [k, v] of Object.entries(table)) {
    if (norm(k) === key) return v;
  }
  return null;
}

/**
 * Backfills defaults onto a config loaded from storage — the per-project JSON blob is unversioned,
 * so a config saved before `statusMapping` existed loads with it undefined. Applied at load time
 * (repository.getJiraConfig/listJiraConfigs) so every consumer sees a populated map.
 */
export function withJiraConfigDefaults(config: JiraProjectConfig): JiraProjectConfig {
  const statusMapping = config.statusMapping && Object.keys(config.statusMapping).length > 0
    ? config.statusMapping
    : { ...DEFAULT_JIRA_STATUS_MAPPING };
  const hotlineLabel = config.hotlineLabel && config.hotlineLabel.trim() ? config.hotlineLabel : DEFAULT_HOTLINE_LABEL;
  if (statusMapping === config.statusMapping && hotlineLabel === config.hotlineLabel) return config;
  return { ...config, statusMapping, hotlineLabel };
}
