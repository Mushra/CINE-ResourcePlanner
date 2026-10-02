// Re-materializes the global dependency flow (DependencyTemplate set) into concrete source='template'
// LOQ-dependency edges. This is the pure-DB, Jira-independent half of the flow editor: safe to call on
// LOQ creation, discovery, and on cinematic/LOQ open — it never touches the network and never disturbs
// override/jira edges. The matching logic lives in domain/dependencyFlow (computeTemplateEdges).

import type { PlannerDatabase } from './database';
import { loadPlanningData, replaceTemplateDependenciesForCinematic } from './repository';
import { computeTemplateEdges } from '../domain/dependencyFlow';

export interface FlowMaterializeResult {
  /** Edges inserted for this cinematic (0 when nothing changed). */
  created: number;
  /** Whether the DB was written — false means the stored template edges already matched. */
  changed: boolean;
}

/**
 * Re-materializes the dependency flow for ONE cinematic. No-op (changed:false, nothing written) when
 * the resulting template-edge set — pairs, type, lag and originating template — already matches what's
 * stored, so this is safe to call on every cinematic/LOQ open without churning the dirty flag or
 * rewriting edge ids. When anything differs (a template added/edited/removed, or a new matching LOQ),
 * the cinematic's template edges are replaced wholesale.
 */
export function materializeCinematicFlow(db: PlannerDatabase, cinematicId: string): FlowMaterializeResult {
  const data = loadPlanningData(db);
  const cinematicLoqs = data.loqs.filter((l) => l.cinematicId === cinematicId);
  if (cinematicLoqs.length === 0) return { created: 0, changed: false };

  const loqIds = cinematicLoqs.map((l) => l.id);
  const loqIdSet = new Set(loqIds);
  const edges = computeTemplateEdges(cinematicLoqs, data.dependencyTemplates, data.loqDependencies);

  // Compare the computed edges against the cinematic's current template edges; skip the write when
  // they're identical down to type/lag/templateId (not just the pair set — editing a template's lag
  // keeps the same pairs but must still re-materialize).
  const currentByPair = new Map(
    data.loqDependencies
      .filter((d) => d.source === 'template' && loqIdSet.has(d.predecessorLoqId) && loqIdSet.has(d.successorLoqId))
      .map((d) => [`${d.predecessorLoqId}::${d.successorLoqId}`, d] as const),
  );
  let unchanged = currentByPair.size === edges.length;
  if (unchanged) {
    for (const e of edges) {
      const cur = currentByPair.get(`${e.predecessorLoqId}::${e.successorLoqId}`);
      if (!cur || cur.type !== e.type || cur.lagDays !== e.lagDays || cur.templateId !== e.templateId) {
        unchanged = false;
        break;
      }
    }
  }
  if (unchanged) return { created: 0, changed: false };

  const created = replaceTemplateDependenciesForCinematic(db, loqIds, edges);
  return { created, changed: true };
}

/** Re-materializes the flow across every cinematic in the plan — backs the Settings "Apply flow"
 * button. Returns totals: edges inserted and how many cinematics were actually rewritten. */
export function materializeAllFlow(db: PlannerDatabase): { created: number; cinematicsChanged: number } {
  const data = loadPlanningData(db);
  let created = 0;
  let cinematicsChanged = 0;
  for (const c of data.cinematics) {
    const res = materializeCinematicFlow(db, c.id);
    created += res.created;
    if (res.changed) cinematicsChanged++;
  }
  return { created, cinematicsChanged };
}
