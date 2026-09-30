// Pure engine for discovering Jira LOQ issues that belong to a bound Cinematic but have no matching
// LOQ in the plan — filtered to the departments (disciplines) the user actually tracks. Deterministic,
// no DB/UI/network, in the spirit of jiraBinding.ts. See docs/INTEGRATIONS.md §3 and the discovery
// spike verified against real OVR/NEO data:
//
//  - The epic→LOQ link is a *typed issue link*, not fields.parent (empty on both projects). The link
//    type name is inverted between projects (OVR "is parent task of", NEO "breaks into"), so we never
//    filter on it — we take every outward link (NormalizedJiraIssue.linkedIssueKeys) and let the
//    department keyword do the discrimination. Bugs/test-plans/ad-hoc tasks that merely share the
//    Cinematics List value are NOT linked from the epic, so they're excluded structurally.
//  - The department is only ever a word in the summary (OVR `-`-separated, NEO ` | `-separated). The
//    six tracked departments spell identically on both projects (Anim, Light, VFX, CinDesign,
//    TechAnim, Props) — so a small, configurable keyword set per discipline covers both conventions.
//  - The level (L0-L3) is in the "LOQ Target" field on OVR but *empty* on NEO, where it lives only in
//    the summary text — so we parse it from the summary, using the field as a fallback confirmation.

import type { Discipline, Loq, Person, ResourcePool } from './types';
import type { NormalizedJiraIssue } from '../import/jiraSync';
import { tokenize } from './jiraBinding';
import { personMatchKey } from './identity';

/** One Jira issue that looks like a LOQ of the open Cinematic but isn't in the plan yet. */
export interface DiscoveredLoq {
  jiraKey: string;
  /** Canonical key of the detected department (see disciplineKey). */
  disciplineKey: string;
  /** Display name of the matched plan discipline when one exists, else the raw keyword's discipline
   * key title-cased is not attempted — this is the plan discipline's name, or null when no plan
   * discipline carries these keywords under a resolvable name. */
  disciplineName: string | null;
  /** Id of the matching plan discipline, or null when the keywords resolve to no existing discipline
   * (the UI shows such a row as "create this discipline first", non-addable). */
  disciplineId: string | null;
  /** Parsed LOQ level, e.g. "L1"; null when the issue carries a department but no L0-L3 level (e.g.
   * an OVR "…-CinDesign-MocapPrep" prep task). */
  level: string | null;
  summary: string;
  /** The Jira issue's assignee display name, when set — used to *suggest* a bind target for an
   * unresolved department (see suggestDisciplineForAssignee), never to resolve it automatically. */
  assignee: string | null;
}

/** Canonical key for a discipline name / keyword-map key: diacritic-stripped, lowercased, single-
 * spaced. So the plan's "CIN Design" and a config key "cin design" line up. */
export function disciplineKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Built-in fallback keyword map (keyed by disciplineKey) for the six departments the tool tracks,
 * seeded from the real OVR/NEO summary vocabulary. Overridable globally and per-project — see
 * resolveDiscoveryKeywords. A discipline with no keywords is simply not discoverable. */
export const DEFAULT_DISCOVERY_KEYWORDS: Record<string, string[]> = {
  'anim': ['anim'],
  'light': ['light'],
  'vfx': ['vfx'],
  'cin design': ['cindesign', 'cin design'],
  'tech anim': ['techanim', 'tech anim'],
  'props': ['props'],
};

/** Effective keyword map = per-project override if set, else the global setting if set, else the
 * built-in default. Whole-map replacement (not a merge), so the semantics stay predictable: whoever
 * owns the level defines the entire set. */
export function resolveDiscoveryKeywords(
  perProject: Record<string, string[]> | null | undefined,
  global: Record<string, string[]> | null | undefined,
): Record<string, string[]> {
  return perProject ?? global ?? DEFAULT_DISCOVERY_KEYWORDS;
}

const LEVEL_RE = /\bL[0-3]\b/i;

/** Parses the LOQ level from the LOQ Target field (preferred — populated on OVR) or, failing that,
 * from the summary text (NEO leaves the field empty and only writes "… Anim L1"). Null when neither
 * carries an L0-L3 token. */
export function parseLoqLevel(summary: string, loqTargetValue: string | null): string | null {
  const fromField = loqTargetValue?.trim();
  if (fromField && LEVEL_RE.test(fromField)) return fromField.toUpperCase();
  const m = LEVEL_RE.exec(summary);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Detects which department a Jira summary belongs to, given a disciplineKey→keywords map. Returns the
 * matching disciplineKey or null.
 *
 *  - A single-token keyword ("anim", "cindesign") matches only when it's a *whole token* of the
 *    summary — so "TechAnim" (token "techanim") never triggers the "anim" keyword. This is the whole
 *    point of matching on token boundaries rather than substrings.
 *  - A multi-word keyword ("cin design", "tech anim") matches when its alphanumeric-collapsed form is
 *    a substring of the summary's alphanumeric-collapsed form ("cin design" → "cindesign" ⊂
 *    "…cindesignl1"), covering conventions that jam the words together.
 *
 * When several disciplines match, the one whose matched keyword is longest wins (a defensive tie-break;
 * the default vocabulary never overlaps). Deterministic.
 */
export function detectDepartment(summary: string, keywordsByDiscipline: Record<string, string[]>): string | null {
  const tokens = tokenize(summary);
  const collapsed = summary.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  let best: { key: string; len: number } | null = null;
  for (const [key, keywords] of Object.entries(keywordsByDiscipline)) {
    for (const raw of keywords) {
      const kwTokens = tokenize(raw);
      if (kwTokens.size === 0) continue;
      let matched = false;
      if (kwTokens.size === 1) {
        matched = tokens.has([...kwTokens][0]);
      } else {
        const kwCollapsed = [...kwTokens].join('');
        matched = collapsed.includes(kwCollapsed);
      }
      if (matched) {
        const len = raw.replace(/[^a-z0-9]/gi, '').length;
        if (!best || len > best.len) best = { key, len };
      }
    }
  }
  return best?.key ?? null;
}

export interface DiscoverMissingLoqsInput {
  /** The Jira issue bound to the Cinematic (its epic) — its linkedIssueKeys are the LOQ family. */
  epicIssue: NormalizedJiraIssue | null;
  /** Every issue pulled for this Cinematic's family (the batch already fetched on view refresh). */
  familyIssues: NormalizedJiraIssue[];
  /** The plan's existing LOQs under this Cinematic (for coverage). */
  planLoqs: Loq[];
  /** The plan's disciplines (to resolve a detected department to a real disciplineId). */
  disciplines: Discipline[];
  /** Effective disciplineKey→keywords map (see resolveDiscoveryKeywords). */
  keywords: Record<string, string[]>;
}

/**
 * Returns the LOQ-like Jira issues that (a) are outward-linked from the bound epic, (b) carry one of
 * the configured departments in their summary, and (c) aren't already covered by a plan LOQ under
 * this Cinematic — coverage being either the same jiraKey, or the same (discipline × level). Deduped
 * by (disciplineKey, level, jiraKey). Deterministic, sorted by department then level then key.
 */
export function discoverMissingLoqs(input: DiscoverMissingLoqsInput): DiscoveredLoq[] {
  const { epicIssue, familyIssues, planLoqs, disciplines, keywords } = input;
  if (!epicIssue) return [];

  const disciplineIdByKey = new Map<string, string>();
  const disciplineNameByKey = new Map<string, string>();
  for (const d of disciplines) {
    const k = disciplineKey(d.name);
    // First discipline wins a given key (stable by input order).
    if (!disciplineIdByKey.has(k)) {
      disciplineIdByKey.set(k, d.id);
      disciplineNameByKey.set(k, d.name);
    }
  }

  const disciplineNameById = new Map(disciplines.map((d) => [d.id, d.name]));
  const planKeys = new Set(planLoqs.map((l) => l.jiraKey).filter((k): k is string => Boolean(k)));
  // Coverage index: `${disciplineKey}::${level}` already present in the plan.
  const planCoverage = new Set<string>();
  for (const l of planLoqs) {
    const name = disciplineNameById.get(l.disciplineId);
    if (!name) continue;
    planCoverage.add(`${disciplineKey(name)}::${(l.type || '').toUpperCase()}`);
  }

  const linked = new Set(epicIssue.linkedIssueKeys);
  const issueByKey = new Map(familyIssues.map((i) => [i.key, i]));
  const seen = new Set<string>();
  const out: DiscoveredLoq[] = [];

  for (const key of linked) {
    if (planKeys.has(key)) continue; // already bound in the plan
    const issue = issueByKey.get(key);
    if (!issue) continue; // linked child not in the fetched batch (rare; see follow-up note)
    const detected = detectDepartment(issue.summary, keywords);
    if (!detected) continue; // not one of the tracked departments
    const level = parseLoqLevel(issue.summary, issue.loqTarget);
    if (level && planCoverage.has(`${detected}::${level}`)) continue; // same discipline×level already planned
    const dedupe = `${detected}::${level ?? ''}::${issue.key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      jiraKey: issue.key,
      disciplineKey: detected,
      disciplineName: disciplineNameByKey.get(detected) ?? null,
      disciplineId: disciplineIdByKey.get(detected) ?? null,
      level,
      summary: issue.summary,
      assignee: issue.assignee,
    });
  }

  out.sort(
    (a, b) =>
      a.disciplineKey.localeCompare(b.disciplineKey) ||
      (a.level ?? '').localeCompare(b.level ?? '') ||
      a.jiraKey.localeCompare(b.jiraKey),
  );
  return out;
}

/** A discovered LOQ tagged with the Cinematic it belongs to — the project-level shape (see
 * discoverMissingLoqsForProject), where results span many Cinematics rather than one. */
export interface DiscoveredLoqForCinematic extends DiscoveredLoq {
  cinematicId: string;
  cinematicName: string;
}

export interface DiscoverProjectMissingLoqsInput {
  /** Every Cinematic in the project, with its bound Jira key (its epic) when it has one. */
  cinematics: { id: string; name: string; jiraKey: string | null }[];
  /** The whole-project batch already fetched by the Sync-with-Jira drawer. */
  familyIssues: NormalizedJiraIssue[];
  /** Every LOQ in the project (scoped per-Cinematic internally for coverage). */
  planLoqs: Loq[];
  disciplines: Discipline[];
  /** Effective disciplineKey→keywords map (see resolveDiscoveryKeywords). */
  keywords: Record<string, string[]>;
}

/**
 * Project-wide discovery: runs discoverMissingLoqs for every Cinematic that is bound to a Jira epic
 * present in the batch, tagging each result with its Cinematic. Cinematics with no bound epic (or one
 * absent from the batch) are skipped — they carry no epic→LOQ links to walk (cinematic-level discovery
 * is out of scope). A thin aggregator over the per-Cinematic engine; deterministic, sorted by
 * Cinematic name → department → level → key.
 */
export function discoverMissingLoqsForProject(input: DiscoverProjectMissingLoqsInput): DiscoveredLoqForCinematic[] {
  const { cinematics, familyIssues, planLoqs, disciplines, keywords } = input;
  const issueByKey = new Map(familyIssues.map((i) => [i.key, i]));
  const loqsByCinematic = new Map<string, Loq[]>();
  for (const loq of planLoqs) {
    const list = loqsByCinematic.get(loq.cinematicId);
    if (list) list.push(loq);
    else loqsByCinematic.set(loq.cinematicId, [loq]);
  }

  const out: DiscoveredLoqForCinematic[] = [];
  for (const cinematic of cinematics) {
    const epicIssue = cinematic.jiraKey ? issueByKey.get(cinematic.jiraKey) ?? null : null;
    if (!epicIssue) continue;
    const discovered = discoverMissingLoqs({
      epicIssue,
      familyIssues,
      planLoqs: loqsByCinematic.get(cinematic.id) ?? [],
      disciplines,
      keywords,
    });
    for (const d of discovered) out.push({ ...d, cinematicId: cinematic.id, cinematicName: cinematic.name });
  }

  out.sort(
    (a, b) =>
      a.cinematicName.localeCompare(b.cinematicName) ||
      a.disciplineKey.localeCompare(b.disciplineKey) ||
      (a.level ?? '').localeCompare(b.level ?? '') ||
      a.jiraKey.localeCompare(b.jiraKey),
  );
  return out;
}

/**
 * Suggests which plan discipline to bind an unresolved department to, inferred from a discovered
 * LOQ's Jira assignee: match the assignee's display name to a tool Person (personMatchKey — the same
 * accent/order-insensitive key that merges people across imports), then take that Person's pool's
 * discipline. A *suggestion* only — the caller pre-fills the bind picker with it but never binds
 * without the user confirming (the assignee's own discipline may differ from the department the LOQ
 * is filed under). Returns null when the assignee is empty, matches no Person, or that Person has no
 * pool/discipline. Deterministic; the first Person that matches wins.
 */
export function suggestDisciplineForAssignee(
  assignee: string | null,
  people: Person[],
  pools: ResourcePool[],
): string | null {
  const name = assignee?.trim();
  if (!name) return null;
  const key = personMatchKey(name);
  const person = people.find((p) => personMatchKey(p.name) === key);
  if (!person?.poolId) return null;
  return pools.find((p) => p.id === person.poolId)?.disciplineId ?? null;
}

/** Group-level convenience over suggestDisciplineForAssignee: the first discipline any of the rows'
 * assignees resolves to (rows in an unresolved department group share the department but may carry
 * different assignees). Null when none resolves. */
export function suggestDisciplineForRows(
  rows: { assignee?: string | null }[],
  people: Person[],
  pools: ResourcePool[],
): string | null {
  for (const r of rows) {
    const id = suggestDisciplineForAssignee(r.assignee ?? null, people, pools);
    if (id) return id;
  }
  return null;
}
