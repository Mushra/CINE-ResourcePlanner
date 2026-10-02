// Pure materializer for the dependency "flow": turns the global DependencyTemplate set into concrete
// LOQ-dependency edges for one cinematic. Deterministic, no DB/UI/network — in the spirit of
// jiraBinding.ts / loqDiscovery.ts. A template matches on (discipline, LOQ type) at both ends; every
// pair of LOQs in the cinematic that fits a template's predecessor/successor shape yields one edge.
// See docs/PLANNING_ENGINE.md §6.1 (templates/overrides) — the model that was specced but never wired.

import type { DependencyTemplate, DependencyType, Loq, LoqDependency } from './types';
import { wouldCreateCycle } from './loqGraph';

export interface TemplateEdge {
  predecessorLoqId: string;
  successorLoqId: string;
  type: DependencyType;
  lagDays: number;
  /** The DependencyTemplate this edge was materialized from (loq_dependencies.template_id). */
  templateId: string;
}

/** Case/whitespace-tolerant match of a LOQ against a template endpoint (discipline id + free-text
 * LOQ type). LOQ type is free text ("L1", "Mocap Prep"), so it's compared trimmed and case-folded. */
function endpointMatches(loq: Loq, disciplineId: string, loqType: string): boolean {
  return loq.disciplineId === disciplineId && loq.type.trim().toLowerCase() === loqType.trim().toLowerCase();
}

/**
 * Materializes the dependency flow for ONE cinematic's LOQs. Edges are:
 *  - within the cinematic only (both endpoints drawn from `cinematicLoqs`);
 *  - de-duplicated on (predecessor, successor);
 *  - skipped when that pair is already owned by a non-template edge (source 'override'/'jira') — a
 *    manual / MS Project / Jira edge always wins over the template mirror and is never overwritten;
 *  - cycle-guarded against the surviving non-template edges plus the edges already accepted here.
 *
 * `existingDeps` is the full plan dependency list (any cinematic). Pure/deterministic; the result is
 * ordered by template order then predecessor/successor id for stable output.
 */
export function computeTemplateEdges(
  cinematicLoqs: Loq[],
  templates: DependencyTemplate[],
  existingDeps: LoqDependency[],
): TemplateEdge[] {
  const ownedPairs = new Set(
    existingDeps.filter((d) => d.source !== 'template').map((d) => `${d.predecessorLoqId}::${d.successorLoqId}`),
  );
  // Seed the cycle base with every edge that will survive the re-materialization (non-template ones).
  const accumulator = existingDeps
    .filter((d) => d.source !== 'template')
    .map((d) => ({ predecessorLoqId: d.predecessorLoqId, successorLoqId: d.successorLoqId }));
  const seen = new Set<string>();
  const out: TemplateEdge[] = [];

  for (const tpl of templates) {
    const preds = cinematicLoqs.filter((l) => endpointMatches(l, tpl.predecessorDisciplineId, tpl.predecessorLoqType));
    const succs = cinematicLoqs.filter((l) => endpointMatches(l, tpl.successorDisciplineId, tpl.successorLoqType));
    for (const p of preds) {
      for (const s of succs) {
        if (p.id === s.id) continue; // a template whose two ends match the same LOQ — never a self-edge
        const pair = `${p.id}::${s.id}`;
        if (ownedPairs.has(pair) || seen.has(pair)) continue;
        if (wouldCreateCycle(accumulator, p.id, s.id)) continue;
        seen.add(pair);
        accumulator.push({ predecessorLoqId: p.id, successorLoqId: s.id });
        out.push({ predecessorLoqId: p.id, successorLoqId: s.id, type: tpl.type, lagDays: tpl.lagDays, templateId: tpl.id });
      }
    }
  }
  return out;
}
