// Writes a NormalizedMppImport into exactly one Project — see src/import/mppImport.ts for how the
// data got there and docs/INTEGRATIONS.md for why the scoping rule below is non-negotiable: a .mpp
// import must never create or modify a row belonging to any project other than targetProjectId,
// even when a Jira key collides with a LOQ that already exists elsewhere. That case is handled by
// skipping + warning rather than reassigning or overwriting the other project's row.
import type { Cinematic, Discipline, Loq, LoqDependency } from '../domain/types';
import { genericPoolName, isGenericPoolName, normalizeKey, personMatchKey } from '../domain/identity';
import { wouldCreateCycle } from '../domain/loqGraph';
import type { PlannerDatabase } from './database';
import {
  createCinematic,
  createDiscipline,
  createLoq,
  createLoqCommitmentEvent,
  createLoqDependency,
  createLoqResource,
  createPerson,
  createPool,
  loadPlanningData,
  updateLoq,
} from './repository';
import type { NormalizedMppImport } from '../import/mppImport';

export type MppDisciplineResolution = { kind: 'existing'; id: string } | { kind: 'new'; name: string; color: string };

export interface MppApplyReport {
  cinematicsCreated: number;
  cinematicsMatched: number;
  disciplinesCreated: number;
  loqsCreated: number;
  loqsUpdated: number;
  loqsSkippedOtherProject: number;
  peopleCreated: number;
  peopleMatched: number;
  resourcesLinked: number;
  dependenciesCreated: number;
  dependenciesSkippedCycle: number;
  warnings: string[];
}

const IMPORT_CHANGED_BY = 'MS Project import';
const IMPORT_REASON = 'Imported from .mpp';

export function applyMppImport(
  db: PlannerDatabase,
  normalized: NormalizedMppImport,
  targetProjectId: string,
  disciplineMap: Record<string, MppDisciplineResolution>,
): MppApplyReport {
  const data = loadPlanningData(db);
  const warnings = [...normalized.report.warnings];
  const report: MppApplyReport = {
    cinematicsCreated: 0,
    cinematicsMatched: 0,
    disciplinesCreated: 0,
    loqsCreated: 0,
    loqsUpdated: 0,
    loqsSkippedOtherProject: 0,
    peopleCreated: 0,
    peopleMatched: 0,
    resourcesLinked: 0,
    dependenciesCreated: 0,
    dependenciesSkippedCycle: 0,
    warnings,
  };

  // --- Disciplines: resolved via the caller-supplied map (built from the interactive mapping step
  // in the UI), never guessed here — see the plan's "auto-match else prompt" UX decision. ---
  const disciplines = [...data.disciplines];
  const disciplineIdByCode = new Map<string, string>();
  for (const code of normalized.report.disciplineCodes) {
    const resolution = disciplineMap[code];
    if (!resolution) {
      warnings.push(`No discipline mapping was supplied for "${code}" — its LOQs were skipped.`);
      continue;
    }
    if (resolution.kind === 'existing') {
      disciplineIdByCode.set(code, resolution.id);
      continue;
    }
    const created = createDiscipline(db, { name: resolution.name, color: resolution.color });
    disciplines.push(created);
    disciplineIdByCode.set(code, created.id);
    report.disciplinesCreated++;
  }

  // --- Cinematics: indexed and created strictly within targetProjectId. ---
  const cinematics = [...data.cinematics];
  const cinematicIdByKey = new Map<string, string>();
  for (const c of cinematics) if (c.projectId === targetProjectId) cinematicIdByKey.set(normalizeKey(c.name), c.id);
  const resolvedCinematicKeys = new Set<string>();
  function resolveCinematicId(name: string): string {
    const key = normalizeKey(name);
    const existingId = cinematicIdByKey.get(key);
    if (existingId) {
      if (!resolvedCinematicKeys.has(key)) {
        resolvedCinematicKeys.add(key);
        report.cinematicsMatched++;
      }
      return existingId;
    }
    const created: Cinematic = createCinematic(db, { projectId: targetProjectId, name, targetDate: null, notes: '' });
    cinematics.push(created);
    cinematicIdByKey.set(key, created.id);
    resolvedCinematicKeys.add(key);
    report.cinematicsCreated++;
    return created.id;
  }

  // --- People: fuzzy-matched by personMatchKey (accents/case/word-order insensitive) per the
  // plan's UX decision, falling back to creating a new person with a discipline-only hint — the
  // domain model has no job-title field, and MPXJ resource-level custom fields were empty in the
  // file this shim was validated against, so there is nothing more to feed than that hint. ---
  const pools = [...data.pools];
  const people = [...data.people];
  const personIdByMatchKey = new Map<string, string>();
  for (const p of people) personIdByMatchKey.set(personMatchKey(p.name), p.id);
  const resolvedPersonKeys = new Set<string>();
  const rosterGroupByName = new Map<string, string | null>();
  for (const r of normalized.roster) rosterGroupByName.set(r.name, r.group);

  const genericPoolIdByDiscipline = new Map<string, string>();
  function resolveGenericPoolId(disciplineId: string): string {
    const cached = genericPoolIdByDiscipline.get(disciplineId);
    if (cached) return cached;
    const existing = pools.find((p) => p.disciplineId === disciplineId && isGenericPoolName(p.name));
    if (existing) {
      genericPoolIdByDiscipline.set(disciplineId, existing.id);
      return existing.id;
    }
    const discipline = disciplines.find((d) => d.id === disciplineId);
    const created = createPool(db, {
      name: genericPoolName(discipline?.name ?? 'Unknown'),
      disciplineId,
      color: discipline?.color ?? '#6b7280',
      capacityFte: 0,
    });
    pools.push(created);
    genericPoolIdByDiscipline.set(disciplineId, created.id);
    return created.id;
  }

  function resolvePersonId(name: string, disciplineIdHint: string | null): string {
    const key = personMatchKey(name);
    const existingId = personIdByMatchKey.get(key);
    if (existingId) {
      if (!resolvedPersonKeys.has(key)) {
        resolvedPersonKeys.add(key);
        report.peopleMatched++;
      }
      return existingId;
    }
    const poolId = disciplineIdHint ? resolveGenericPoolId(disciplineIdHint) : null;
    const created = createPerson(db, { name, poolId, capacityFte: 1, active: true, notes: '', team: '', site: '' });
    people.push(created);
    personIdByMatchKey.set(key, created.id);
    resolvedPersonKeys.add(key);
    report.peopleCreated++;
    return created.id;
  }

  // --- LOQs: matched globally by jiraKey. A collision with a LOQ under another project is
  // skipped, never rewritten — this is the concrete mechanism enforcing single-project scoping. ---
  const cinematicProjectById = new Map<string, string>();
  for (const c of cinematics) cinematicProjectById.set(c.id, c.projectId);
  const existingLoqByJiraKey = new Map<string, Loq>();
  for (const l of data.loqs) if (l.jiraKey) existingLoqByJiraKey.set(l.jiraKey, l);
  const loqIdByJiraKey = new Map<string, string>();
  const disciplineCodeByJiraKey = new Map<string, string>();

  for (const loqInput of normalized.loqs) {
    disciplineCodeByJiraKey.set(loqInput.jiraKey, loqInput.disciplineCode);
    const disciplineId = disciplineIdByCode.get(loqInput.disciplineCode);
    if (!disciplineId) continue; // unmapped code — already warned above

    const existing = existingLoqByJiraKey.get(loqInput.jiraKey);
    if (existing) {
      const existingProjectId = cinematicProjectById.get(existing.cinematicId);
      if (existingProjectId !== targetProjectId) {
        report.loqsSkippedOtherProject++;
        warnings.push(`Skipped ${loqInput.jiraKey} — it already exists under a different project and was left untouched.`);
        continue;
      }
      const cinematicId = resolveCinematicId(loqInput.cinematicName);
      const datesChanged = existing.committedStart !== loqInput.start || existing.committedFinish !== loqInput.finish;
      const updated: Loq = {
        ...existing,
        cinematicId,
        disciplineId,
        type: loqInput.type,
        estimateDays: loqInput.estimateDays,
        committedStart: datesChanged ? loqInput.start : existing.committedStart,
        committedFinish: datesChanged ? loqInput.finish : existing.committedFinish,
      };
      if (datesChanged) {
        createLoqCommitmentEvent(db, {
          loqId: existing.id,
          committedStart: loqInput.start,
          committedFinish: loqInput.finish,
          changedBy: IMPORT_CHANGED_BY,
          changedAt: new Date().toISOString(),
          reason: IMPORT_REASON,
          comment: '',
        });
      }
      updateLoq(db, updated);
      existingLoqByJiraKey.set(loqInput.jiraKey, updated);
      loqIdByJiraKey.set(loqInput.jiraKey, existing.id);
      report.loqsUpdated++;
    } else {
      const cinematicId = resolveCinematicId(loqInput.cinematicName);
      const created = createLoq(db, {
        cinematicId,
        disciplineId,
        jiraKey: loqInput.jiraKey,
        type: loqInput.type,
        status: 'TODO',
        estimateDays: loqInput.estimateDays,
        committedStart: null,
        committedFinish: null,
        actualFinish: null,
        dodRef: '',
      });
      // Establishes an audit-trail entry for the import-sourced commitment, unlike the plain
      // manual "New LOQ" UI flow (CinematicDetail.tsx) which has no prior state to record against.
      createLoqCommitmentEvent(db, {
        loqId: created.id,
        committedStart: loqInput.start,
        committedFinish: loqInput.finish,
        changedBy: IMPORT_CHANGED_BY,
        changedAt: new Date().toISOString(),
        reason: IMPORT_REASON,
        comment: '',
      });
      const withDates: Loq = { ...created, committedStart: loqInput.start, committedFinish: loqInput.finish };
      updateLoq(db, withDates);
      existingLoqByJiraKey.set(loqInput.jiraKey, withDates);
      loqIdByJiraKey.set(loqInput.jiraKey, created.id);
      report.loqsCreated++;
    }
  }

  // --- Resource assignments: only for LOQs that actually resolved into this project. ---
  for (const res of normalized.resources) {
    const loqId = loqIdByJiraKey.get(res.jiraKey);
    if (!loqId) continue; // the LOQ was skipped (other project) or its discipline was unmapped
    const groupHint = res.personGroup ? disciplineIdByCode.get(res.personGroup) ?? null : null;
    const loqDisciplineHint = disciplineIdByCode.get(disciplineCodeByJiraKey.get(res.jiraKey) ?? '') ?? null;
    const personId = resolvePersonId(res.personName, groupHint ?? loqDisciplineHint);
    createLoqResource(db, { loqId, personId, startDate: res.start, finishDate: res.finish, fte: res.fte });
    report.resourcesLinked++;
  }

  // --- Dependencies: only when both endpoints resolved into this project's LOQs. ---
  const loqDependencies: Pick<LoqDependency, 'predecessorLoqId' | 'successorLoqId'>[] = [...data.loqDependencies];
  for (const dep of normalized.dependencies) {
    const predecessorLoqId = loqIdByJiraKey.get(dep.predecessorJiraKey);
    const successorLoqId = loqIdByJiraKey.get(dep.successorJiraKey);
    if (!predecessorLoqId || !successorLoqId) continue;
    if (wouldCreateCycle(loqDependencies, predecessorLoqId, successorLoqId)) {
      report.dependenciesSkippedCycle++;
      warnings.push(`Skipped dependency ${dep.predecessorJiraKey} -> ${dep.successorJiraKey} — it would create a cycle.`);
      continue;
    }
    createLoqDependency(db, { predecessorLoqId, successorLoqId, type: dep.type, lagDays: dep.lagDays, source: 'override', templateId: null });
    loqDependencies.push({ predecessorLoqId, successorLoqId });
    report.dependenciesCreated++;
  }

  return report;
}

// Re-exported for callers that only need the discipline-code list to build the interactive mapping
// step's initial suggestions (auto-match by name) before calling applyMppImport.
export function suggestDisciplineMatches(disciplineCodes: string[], existing: Discipline[]): Record<string, MppDisciplineResolution> {
  const byNormalizedName = new Map<string, Discipline>();
  for (const d of existing) byNormalizedName.set(normalizeKey(d.name), d);
  const result: Record<string, MppDisciplineResolution> = {};
  for (const code of disciplineCodes) {
    const match = byNormalizedName.get(normalizeKey(code));
    if (match) result[code] = { kind: 'existing', id: match.id };
  }
  return result;
}
