// Pure heuristic for proposing Cinematic/LOQ <-> Jira issue bindings (see docs/INTEGRATIONS.md §3
// and the Phase 5 plan). Deterministic token-overlap scoring, no fuzzy-matching library, in the
// spirit of identity.ts's personMatchKey. Every proposal is confirmable/overridable in the UI —
// this module only ever suggests, it never writes anything (see applyJiraSync.ts for that).
//
// The cascade below was revised after a discovery spike against two real Jira Server/DC projects
// (OVR, NEO) showed the original Epic->children (fields.parent) assumption doesn't hold generally:
// OVR's Cinematic-level issues have no children via `parent` at all, and per-project summary
// conventions differ ("-" separated on OVR, " | " separated on NEO). The signals below are ordered
// by how much they can be trusted, falling through to the next when a project's Jira doesn't offer
// the stronger one — see docs/INTEGRATIONS.md §3 for the full per-signal writeup.

import type { Cinematic, Discipline, Loq } from './types';
import type { NormalizedJiraBatch, NormalizedJiraIssue } from '../import/jiraSync';

/**
 * Which signal produced a proposal — shown in the drawer as "bound to X, via Y" (see
 * JiraBindingDrawer.tsx's BindingSelect) so the user can judge how much to trust it before
 * overriding, by decreasing confidence:
 *  - 'exact-key'        — the row already carries a jiraKey present in this batch. Trusted outright.
 *  - 'cinematics-field' — the Ubisoft-wide "Cinematics List" custom field (confirmed as the same
 *    field id on every discovery-spike project) names this Cinematic exactly (and, for a LOQ, also
 *    agrees with the "LOQ Target" field). Strongest heuristic signal.
 *  - 'epic-link'        — a real Epic Link / Parent Issue / native `parent` relationship, when the
 *    project has one (confirmed present on NEO, absent on OVR — never assumed).
 *  - 'name'              — Jaccard token-overlap on the issue summary. Repli/fallback.
 *  - 'unmatched'         — nothing cleared the threshold; left for manual choice in the drawer.
 */
export type BindingKind = 'exact-key' | 'cinematics-field' | 'epic-link' | 'name' | 'unmatched';

export interface CinematicBindingProposal {
  /** Which signal produced this proposal — see BindingKind. */
  via: BindingKind;
  cinematicId: string;
  proposedKey: string | null;
  /** Jaccard token-overlap score used to pick among several equally-valid candidates (or, for
   * 'name', to gate against the threshold). Null for 'exact-key' (no scoring needed) and for
   * 'unmatched' when there was nothing at all to score against. */
  score: number | null;
}

export interface LoqBindingProposal {
  via: BindingKind;
  loqId: string;
  proposedKey: string | null;
  score: number | null;
}

export interface JiraBindingProposals {
  cinematics: CinematicBindingProposal[];
  loqs: LoqBindingProposal[];
}

export interface JiraBindingOptions {
  /** Restricts binding candidates to issues whose scopeValue equals this (e.g. "CIN 2" on the "CIN
   * level" department-ownership field — see docs/INTEGRATIONS.md §3.2 and
   * JiraProjectConfig.scopeField/scopeValue in types.ts). This is a scope/ownership filter, not a
   * maturity or quality signal: issues outside this department are simply not candidates at all.
   * Null/undefined = no filtering (e.g. OVR, which has no such field). Never applied to the
   * exact-key check — an explicitly-set jiraKey is trusted regardless of scope. */
  scopeValue?: string | null;
  /** Jaccard threshold for the 'name' fallback level only — the field/link levels are trusted on
   * relationship alone (score is tie-breaking, not gating) once at least one candidate exists. */
  threshold?: number;
}

const DEFAULT_MATCH_THRESHOLD = 0.5;

/**
 * Canonicalization key for a Cinematic/issue name, in the spirit of personMatchKey: strip
 * diacritics, lowercase, sort whitespace-split tokens — so word order and accents stop mattering.
 * Exposed mainly so callers/tests can check two names canonicalize the same way; the actual
 * matching below uses `tokenize`'s set-based scoring rather than this joined string.
 */
export function jiraMatchKey(s: string): string {
  return Array.from(tokenize(s)).sort().join(' ');
}

function tokenize(s: string): Set<string> {
  const stripped = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return new Set(stripped.split(/[^a-z0-9]+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Picks the highest-scoring candidate by summary token-overlap. Never gates on the score itself —
 * callers decide whether "some candidates, best-scored" is enough (field/link levels) or whether
 * the score must additionally clear a threshold (the 'name' fallback level). Null only when
 * `candidates` is empty. */
function bestCandidate<T extends { key: string; summary: string }>(
  tokens: Set<string>,
  candidates: T[],
): { key: string; score: number } | null {
  let best: { key: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = jaccard(tokens, tokenize(candidate.summary));
    if (!best || score > best.score) best = { key: candidate.key, score };
  }
  return best;
}

/**
 * Proposes bindings for every Cinematic and LOQ, trying signals in decreasing order of confidence
 * (see BindingKind) and keeping the first one that produces a candidate:
 *
 * Cinematic -> issue: exact-key -> cinematics-field (issue.cinematicName === cinematic.name) ->
 * name (Jaccard over all — scoped — issues, gated by `threshold`) -> unmatched.
 *
 * LOQ -> issue: exact-key -> cinematics-field (issue.cinematicName === parent Cinematic's name AND
 * issue.loqTarget === loq.type) -> epic-link (issue.epicLinkKey/parentKey === the Cinematic's own
 * matched issue key, when one was found above) -> name (Jaccard over all scoped issues, gated) ->
 * unmatched.
 *
 * An optional scope filter (`options.scopeValue`) restricts every candidate pool up front — see
 * JiraBindingOptions. Pure and deterministic — same inputs always produce the same proposals.
 */
export function suggestJiraBindings(
  cinematics: Cinematic[],
  loqs: Loq[],
  disciplines: Discipline[],
  batch: NormalizedJiraBatch,
  options: JiraBindingOptions = {},
): JiraBindingProposals {
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const scopeValue = options.scopeValue ?? null;
  const scopedIssues = scopeValue ? batch.issues.filter((issue) => issue.scopeValue === scopeValue) : batch.issues;

  // exact-key is checked against the *full*, unscoped batch: an explicit key is trusted outright,
  // regardless of any department-scope filter.
  const issueKeys = new Set(batch.issues.map((issue) => issue.key));
  const disciplineNameById = new Map(disciplines.map((d) => [d.id, d.name]));

  const cinematicProposals: CinematicBindingProposal[] = [];
  const matchedIssueKeyByCinematicId = new Map<string, string>();

  for (const cinematic of cinematics) {
    if (cinematic.jiraKey && issueKeys.has(cinematic.jiraKey)) {
      cinematicProposals.push({ via: 'exact-key', cinematicId: cinematic.id, proposedKey: cinematic.jiraKey, score: null });
      matchedIssueKeyByCinematicId.set(cinematic.id, cinematic.jiraKey);
      continue;
    }

    const fieldCandidates = scopedIssues.filter((issue) => issue.cinematicName === cinematic.name);
    const fieldBest = bestCandidate(tokenize(cinematic.name), fieldCandidates);
    if (fieldBest) {
      cinematicProposals.push({ via: 'cinematics-field', cinematicId: cinematic.id, proposedKey: fieldBest.key, score: fieldBest.score });
      matchedIssueKeyByCinematicId.set(cinematic.id, fieldBest.key);
      continue;
    }

    const nameBest = bestCandidate(tokenize(cinematic.name), scopedIssues);
    if (nameBest && nameBest.score >= threshold) {
      cinematicProposals.push({ via: 'name', cinematicId: cinematic.id, proposedKey: nameBest.key, score: nameBest.score });
      matchedIssueKeyByCinematicId.set(cinematic.id, nameBest.key);
    } else {
      cinematicProposals.push({ via: 'unmatched', cinematicId: cinematic.id, proposedKey: null, score: nameBest?.score ?? null });
    }
  }

  const cinematicById = new Map(cinematics.map((c) => [c.id, c]));
  const loqProposals: LoqBindingProposal[] = [];

  for (const loq of loqs) {
    if (loq.jiraKey && issueKeys.has(loq.jiraKey)) {
      loqProposals.push({ via: 'exact-key', loqId: loq.id, proposedKey: loq.jiraKey, score: null });
      continue;
    }

    const cinematic = cinematicById.get(loq.cinematicId);
    const disciplineName = disciplineNameById.get(loq.disciplineId) ?? '';
    const nameTokens = tokenize(`${disciplineName} ${loq.type}`);

    if (cinematic) {
      const fieldCandidates = scopedIssues.filter(
        (issue) => issue.cinematicName === cinematic.name && issue.loqTarget === loq.type,
      );
      const fieldBest = bestCandidate(nameTokens, fieldCandidates);
      if (fieldBest) {
        loqProposals.push({ via: 'cinematics-field', loqId: loq.id, proposedKey: fieldBest.key, score: fieldBest.score });
        continue;
      }
    }

    const issueKey = cinematic ? matchedIssueKeyByCinematicId.get(cinematic.id) : undefined;
    if (issueKey) {
      const epicCandidates = scopedIssues.filter(
        (issue: NormalizedJiraIssue) => issue.epicLinkKey === issueKey || issue.parentKey === issueKey,
      );
      const epicBest = bestCandidate(nameTokens, epicCandidates);
      if (epicBest) {
        loqProposals.push({ via: 'epic-link', loqId: loq.id, proposedKey: epicBest.key, score: epicBest.score });
        continue;
      }
    }

    const nameBest = bestCandidate(nameTokens, scopedIssues);
    if (nameBest && nameBest.score >= threshold) {
      loqProposals.push({ via: 'name', loqId: loq.id, proposedKey: nameBest.key, score: nameBest.score });
    } else {
      loqProposals.push({ via: 'unmatched', loqId: loq.id, proposedKey: null, score: nameBest?.score ?? null });
    }
  }

  return { cinematics: cinematicProposals, loqs: loqProposals };
}
