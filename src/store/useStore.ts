import { create } from 'zustand';
import { PlannerDatabase } from '../db/database';
import {
  loadPlanningData, BASE_SCENARIO_ID,
  createProject as repoCreateProject, updateProject as repoUpdateProject, deleteProject as repoDeleteProject,
  createPool as repoCreatePool, updatePool as repoUpdatePool, deletePool as repoDeletePool, deletePoolCascade as repoDeletePoolCascade,
  getOrCreateRequirement, setRequirementAllocation as repoSetRequirementAllocation, setRequirementAllocations as repoSetRequirementAllocations, deleteRequirement as repoDeleteRequirement,
  createDiscipline as repoCreateDiscipline, updateDiscipline as repoUpdateDiscipline, deleteDiscipline as repoDeleteDiscipline, deleteDisciplineCascade as repoDeleteDisciplineCascade,
  createPerson as repoCreatePerson, updatePerson as repoUpdatePerson, deletePerson as repoDeletePerson,
  getOrCreatePersonAssignment, setPersonAssignmentAllocation as repoSetPersonAssignmentAllocation, setPersonAssignmentAllocations as repoSetPersonAssignmentAllocations, deletePersonAssignment as repoDeletePersonAssignment,
  upsertStructureOverride as repoUpsertStructureOverride, deleteStructureOverride as repoDeleteStructureOverride,
  deleteStructureOverrideByKey as repoDeleteStructureOverrideByKey,
  createCinematic as repoCreateCinematic, updateCinematic as repoUpdateCinematic, deleteCinematic as repoDeleteCinematic,
  createLoq as repoCreateLoq, updateLoq as repoUpdateLoq, deleteLoq as repoDeleteLoq,
  createLoqResource as repoCreateLoqResource, updateLoqResource as repoUpdateLoqResource, deleteLoqResource as repoDeleteLoqResource,
  createLoqCommitmentEvent as repoCreateLoqCommitmentEvent,
  createVarianceEvent as repoCreateVarianceEvent,
} from '../db/repository';
import { applyRpmImport, type ImportMode } from '../db/applyImport';
import { seedDemoData } from '../db/seed';
import { getStoredFileName, loadAutosave, saveAutosave, setStoredFileName } from '../persistence/indexeddb';
import * as files from '../persistence/files';
import { exportWorkbookToBytes } from '../export/xlsx';
import type { ImportReport, NormalizedImport } from '../import/rpmImport';
import { parseRpmWorkbook } from '../import/rpmImport';
import { parseStaffingWorkbook } from '../import/staffingImport';
import { PlanningEngine, round2 } from '../engine/planning';
import type { Cinematic, Discipline, Loq, LoqResource, PlanningData, Period, Person, Project, ResourcePool, StructureOverrideKind } from '../domain/types';
import { emptyPlanningData } from '../domain/types';
import { applyStructureOverrides } from '../domain/overrides';
import { normalizeKey, genericPoolName, isGenericPoolName } from '../domain/identity';
import { addMonths, comparePeriod, formatPeriodLabel, isoFirstDayOfPeriod, isoLastDayOfPeriod, periodFromISODate, periodRange } from '../domain/periods';
import { spreadHue } from '../ui/lib/colors';
import { isoDiffDays } from '../ui/timeline/timelineMath';
import { useUiStore } from './useUiStore';

export type ToastKind = 'success' | 'error' | 'info';

/** 'overwrite' sets every specific role/month's requirement to the currently assigned FTE (including down to 0);
 * 'fill-empty' only sets requirement where none is set yet, leaving existing requirements untouched. */
export type FeedRequirementsMode = 'overwrite' | 'fill-empty';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

export type Theme = 'light' | 'dark';

interface StoreState {
  status: 'loading' | 'ready' | 'error';
  errorMessage: string | null;

  db: PlannerDatabase | null;
  data: PlanningData;
  engine: PlanningEngine;

  fileName: string;
  fileHandle: FileSystemFileHandle | null;
  dirty: boolean;

  theme: Theme;
  toasts: Toast[];
  lastImportReport: ImportReport | null;

  init: () => Promise<void>;
  toast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: string) => void;
  toggleTheme: () => void;

  newDatabase: (seed: boolean) => Promise<void>;
  openDatabase: () => Promise<void>;
  saveDatabase: () => Promise<void>;
  saveDatabaseAs: () => Promise<void>;
  exportXlsx: () => Promise<void>;
  importRpmExport: (mode: ImportMode) => Promise<ImportReport | null>;
  importStaffingReport: (mode: ImportMode) => Promise<ImportReport | null>;

  createProject: (input: Omit<Project, 'id' | 'sortOrder'>) => Project;
  updateProject: (project: Project) => void;
  deleteProject: (projectId: string) => void;

  createPool: (input: Omit<ResourcePool, 'id' | 'sortOrder'>) => ResourcePool;
  updatePool: (pool: ResourcePool) => void;
  /** cascade=true also deletes every person in the role (and their assignments); otherwise they
   * fall back to "no role", like any other pool-less person. */
  deletePool: (poolId: string, cascade?: boolean) => void;

  createDiscipline: (input: Omit<Discipline, 'id' | 'sortOrder'>) => Discipline;
  updateDiscipline: (discipline: Discipline) => void;
  /** cascade=true also deletes every role under it and their people (and assignments); otherwise
   * its roles fall back to "Unassigned", like any other discipline-less role. */
  deleteDiscipline: (disciplineId: string, cascade?: boolean) => void;

  createPerson: (input: Omit<Person, 'id' | 'sortOrder'>) => Person;
  updatePerson: (person: Person) => void;
  batchUpdatePeople: (personIds: string[], patch: Partial<Pick<Person, 'team' | 'poolId' | 'active'>>) => void;
  deletePerson: (personId: string) => void;

  setRequirement: (projectId: string, poolId: string, period: Period, fte: number) => void;
  setRequirementRange: (projectId: string, poolId: string, periods: Period[], fte: number) => void;
  setDisciplineRequirement: (projectId: string, disciplineId: string, period: Period, fte: number) => void;
  setDisciplineRequirementRange: (projectId: string, disciplineId: string, periods: Period[], fte: number) => void;
  setPersonAssignment: (personId: string, projectId: string, period: Period, fte: number) => void;
  setPersonAssignmentRange: (personId: string, projectId: string, periods: Period[], fte: number) => void;
  clearRequirementPool: (projectId: string, poolId: string) => void;
  clearPersonAssignment: (personId: string, projectId: string) => void;
  feedRequirementsFromAssignments: (projectId: string, mode: FeedRequirementsMode) => void;
  feedAllRequirementsFromAssignments: (mode: FeedRequirementsMode) => void;

  /** Shifts every requirement/assignment allocation of a project by `monthDelta` months — used when the
   * user drags a project bar to move it and chooses to bring its resources along. */
  shiftProjectAllocations: (projectId: string, monthDelta: number) => void;
  /** Fills newly-added months (when a project's end is dragged later) from the last recorded value at
   * each pool/person, for needs and/or assignments per the user's choice. */
  autofillProjectExtension: (projectId: string, fromPeriod: Period, toPeriod: Period, opts: { needs: boolean; assignments: boolean }) => void;

  createCinematic: (input: Omit<Cinematic, 'id' | 'sortOrder'>) => Cinematic;
  updateCinematic: (cinematic: Cinematic) => void;
  deleteCinematic: (cinematicId: string) => void;

  createLoq: (input: Omit<Loq, 'id' | 'sortOrder'>) => Loq;
  updateLoq: (loq: Loq) => void;
  deleteLoq: (loqId: string) => void;
  /** The only path allowed to change a LOQ's committed_start/finish: appends a
   * loq_commitment_events row (attributed to the global producer-name preference) and keeps the
   * loqs.committed_start/finish cache in sync in the same call — see PLANNING_ENGINE.md §3. */
  recommitLoq: (loqId: string, input: { committedStart: string | null; committedFinish: string | null; reason: string; comment: string }) => void;
  /** Declares why forecast differs from committed without touching the committed baseline itself
   * (PLANNING_ENGINE.md §4). deltaDays is computed once at declaration from the LOQ's committed date
   * vs. the given expectedFinish, and never recomputed. */
  declareVariance: (loqId: string, input: { category: string; expectedFinish: string; comment: string }) => void;

  createLoqResource: (input: Omit<LoqResource, 'id'>) => LoqResource;
  updateLoqResource: (resource: LoqResource) => void;
  deleteLoqResource: (resourceId: string) => void;

  setPoolDiscipline: (poolName: string, disciplineName: string) => void;
  setPersonPool: (personName: string, poolName: string) => void;
  setPoolPersonPool: (sourcePoolName: string, targetPoolName: string) => void;
  setPersonDiscipline: (personName: string, disciplineName: string) => void;
  clearOverride: (overrideId: string) => void;
  clearOverrideByKey: (kind: StructureOverrideKind, sourceKey: string) => void;
}

function nextToastId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const LEGACY_DISCIPLINE_COLOR = '#6b7280';

/**
 * Recolors any discipline still on the legacy uniform grey, or sharing a color with another
 * discipline, using the golden-angle hue spread — guarantees sibling disciplines are visually
 * distinct. Deliberate manual colors (unique, non-grey) are left untouched, so this is safe to
 * run on every reload rather than only once.
 */
function normalizeDisciplineColors(db: PlannerDatabase): void {
  const raw = loadPlanningData(db);
  const ordered = [...raw.disciplines].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const usedColors = new Set<string>();
  let index = 0;
  for (const d of ordered) {
    if (d.color === LEGACY_DISCIPLINE_COLOR || usedColors.has(d.color)) {
      let color = spreadHue(index);
      while (usedColors.has(color)) {
        index += 1;
        color = spreadHue(index);
      }
      repoUpdateDiscipline(db, { ...d, color });
      usedColors.add(color);
    } else {
      usedColors.add(d.color);
    }
    index += 1;
  }
}

export const useStore = create<StoreState>((set, get) => {
  function reload(db: PlannerDatabase): void {
    normalizeDisciplineColors(db);
    const raw = loadPlanningData(db);
    const data = applyStructureOverrides(raw, raw.structureOverrides);
    const engine = new PlanningEngine(data, BASE_SCENARIO_ID);
    set({ data, engine });
  }

  function persist(): void {
    const { db } = get();
    if (!db) return;
    const bytes = db.export();
    void saveAutosave(bytes);
    set({ dirty: true });
    reload(db);
  }

  /**
   * Finds (or lazily creates) the hidden pool that carries a discipline's "N people, no role
   * picked" requirement. Matched by disciplineId + isGenericPoolName only (same convention as the
   * v5->v6 migration and every other generic-pool lookup in the app) — NOT by an exact name match
   * against the discipline's current name, since a discipline rename doesn't rename its generic
   * pool. Matching by name would silently spawn a second generic pool after a rename, splitting a
   * discipline's need across two rows so "Overwrite needs from assignments" could never fully zero
   * out the stale one.
   */
  function resolveGenericPoolId(db: PlannerDatabase, disciplineId: string): string | null {
    const discipline = get().data.disciplines.find((d) => d.id === disciplineId);
    if (!discipline) return null;
    const existing = get().data.pools.find((p) => p.disciplineId === disciplineId && isGenericPoolName(p.name));
    if (existing) return existing.id;
    const pool = repoCreatePool(db, { name: genericPoolName(discipline.name), disciplineId, color: discipline.color, capacityFte: 0 });
    return pool.id;
  }

  /**
   * Freezes an entity's `name` at its import-matched value and routes any display rename through
   * a `*_name` structure override instead, so a later merge re-import still matches by the
   * original name (writing straight to `name` would break that match and spawn a duplicate).
   * Returns the frozen name to persist in place of `edited.name`.
   */
  function freezeRename<T extends { name: string; importName?: string }>(
    db: PlannerDatabase,
    kind: StructureOverrideKind,
    original: T | undefined,
    edited: T,
  ): string {
    const frozenName = original?.importName ?? original?.name ?? edited.name;
    const sourceKey = normalizeKey(frozenName);
    if (normalizeKey(edited.name) !== sourceKey) {
      repoUpsertStructureOverride(db, kind, sourceKey, edited.name.trim());
    } else {
      repoDeleteStructureOverrideByKey(db, kind, sourceKey);
    }
    return frozenName;
  }

  /**
   * Copies current assigned FTE onto discipline-need FTE for a project (needs are discipline-only,
   * see resolveGenericPoolId). 'overwrite' mirrors assigned exactly, including down to 0; 'fill-empty'
   * only touches discipline/months with no need set yet. Returns the number of discipline/month cells
   * changed. Does not persist.
   */
  function feedProjectRequirements(db: PlannerDatabase, engine: PlanningEngine, projectId: string, mode: FeedRequirementsMode): number {
    let changed = 0;
    for (const period of engine.projectActivePeriods(projectId)) {
      for (const line of engine.getProjectDisciplineStaffing(projectId, period)) {
        if (mode === 'fill-empty' ? line.required > 0.001 : Math.abs(line.required - line.assigned) < 0.001) continue;
        const poolId = resolveGenericPoolId(db, line.disciplineId);
        if (!poolId) continue;
        const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
        repoSetRequirementAllocation(db, req.id, period, line.assigned);
        changed += 1;
      }
    }
    return changed;
  }

  /** After a fresh assignment write, warns if the person is now over-allocated in any touched period (across all their projects, dispo included). */
  function warnIfOverAllocated(personId: string, periods: Period[]): void {
    const { engine, data } = get();
    const person = data.people.find((p) => p.id === personId);
    if (!person || !person.active) return;
    for (const period of periods) {
      const total = round2(engine.getPersonAssigned(personId, period));
      if (total > person.capacityFte + 0.001) {
        get().toast('error', `${person.name} is staffed at ${total} FTE in ${formatPeriodLabel(period, { withYear: true })}, beyond their capacity of ${person.capacityFte} FTE`);
        return;
      }
    }
  }

  /**
   * When a requirement/assignment write lands outside the project's current lifecycle, grows the
   * project's start/end to cover it and marks the grown edge "estimated" — so editing needs or
   * assignments is never blocked by dates set before the plan changed. A no-op for a zero/negative
   * fte (clearing a cell should never grow the project).
   */
  function extendProjectDatesToCover(db: PlannerDatabase, projectId: string, periods: Period[], fte: number): void {
    if (fte <= 0.001 || periods.length === 0) return;
    const project = get().data.projects.find((p) => p.id === projectId);
    if (!project) return;
    let minPeriod = periods[0];
    let maxPeriod = periods[0];
    for (const p of periods) {
      if (comparePeriod(p, minPeriod) < 0) minPeriod = p;
      if (comparePeriod(p, maxPeriod) > 0) maxPeriod = p;
    }
    const patch: Partial<Project> = {};
    const endPeriod = periodFromISODate(project.endDate);
    if (!endPeriod || comparePeriod(maxPeriod, endPeriod) > 0) {
      patch.endDate = isoLastDayOfPeriod(maxPeriod);
      patch.endCertainty = 'estimated';
    }
    const startPeriod = periodFromISODate(project.startDate);
    if (!startPeriod || comparePeriod(minPeriod, startPeriod) < 0) {
      patch.startDate = isoFirstDayOfPeriod(minPeriod);
      patch.startCertainty = 'estimated';
    }
    if (Object.keys(patch).length > 0) repoUpdateProject(db, { ...project, ...patch });
  }

  async function runImport(parse: (buffer: ArrayBuffer, fileName?: string) => Promise<NormalizedImport>, mode: ImportMode): Promise<ImportReport | null> {
    try {
      const opened = await files.openXlsxFile();
      if (!opened) return null;
      const normalized = await parse(opened.buffer, opened.name);

      const currentDb = get().db;
      const effectiveMode: ImportMode = mode === 'replace' || !currentDb ? 'replace' : 'merge';
      const db = effectiveMode === 'replace' ? await PlannerDatabase.createNew() : currentDb!;
      applyRpmImport(db, normalized, effectiveMode);

      const fileName = effectiveMode === 'replace' ? opened.name.replace(/\.xlsx$/i, '') || 'Imported plan' : get().fileName;
      set({
        db,
        fileName,
        fileHandle: effectiveMode === 'replace' ? null : get().fileHandle,
        dirty: true,
        lastImportReport: normalized.report,
      });
      setStoredFileName(fileName);
      reload(db);
      void saveAutosave(db.export());
      get().toast(
        'success',
        `Imported ${normalized.report.importedRows} rows into ${normalized.report.projectCount} projects / ${normalized.report.personCount} people`,
      );
      return normalized.report;
    } catch (err) {
      get().toast('error', `Import failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  return {
    status: 'loading',
    errorMessage: null,
    db: null,
    data: emptyPlanningData(),
    engine: new PlanningEngine(emptyPlanningData()),
    fileName: 'Untitled plan',
    fileHandle: null,
    dirty: false,
    theme: (localStorage.getItem('cine-planner-theme') as Theme | null) ?? 'light',
    toasts: [],
    lastImportReport: null,

    init: async () => {
      try {
        const existing = await loadAutosave();
        if (existing) {
          const db = await PlannerDatabase.openFromBytes(existing);
          set({ db, status: 'ready', fileName: getStoredFileName() ?? 'Untitled plan' });
          reload(db);
        } else {
          const db = await PlannerDatabase.createNew();
          seedDemoData(db);
          set({ db, status: 'ready', fileName: 'Demo plan' });
          setStoredFileName('Demo plan');
          reload(db);
          void saveAutosave(db.export());
        }
      } catch (err) {
        set({ status: 'error', errorMessage: err instanceof Error ? err.message : String(err) });
      }
    },

    toast: (kind, message) => {
      const id = nextToastId();
      set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
      setTimeout(() => get().dismissToast(id), 4000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    toggleTheme: () => {
      const next = get().theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('cine-planner-theme', next);
      set({ theme: next });
    },

    newDatabase: async (seed) => {
      const db = await PlannerDatabase.createNew();
      if (seed) seedDemoData(db);
      const fileName = seed ? 'Demo plan' : 'Untitled plan';
      set({ db, fileName, fileHandle: null, dirty: false });
      setStoredFileName(fileName);
      reload(db);
      void saveAutosave(db.export());
      get().toast('success', seed ? 'New demo plan created' : 'New empty plan created');
    },

    openDatabase: async () => {
      try {
        const opened = await files.openFile();
        if (!opened) return;
        const db = await PlannerDatabase.openFromBytes(opened.bytes);
        set({ db, fileName: opened.name, fileHandle: opened.handle, dirty: false });
        setStoredFileName(opened.name);
        reload(db);
        void saveAutosave(db.export());
        get().toast('success', `Opened ${opened.name}`);
      } catch (err) {
        get().toast('error', `Could not open file: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    saveDatabase: async () => {
      const { db, fileHandle, fileName } = get();
      if (!db) return;
      try {
        const bytes = db.export();
        if (fileHandle) {
          await files.saveToHandle(fileHandle, bytes);
          set({ dirty: false });
          get().toast('success', `Saved ${fileName}`);
        } else {
          await get().saveDatabaseAs();
        }
      } catch (err) {
        get().toast('error', `Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    saveDatabaseAs: async () => {
      const { db, fileName } = get();
      if (!db) return;
      try {
        const suggested = fileName.endsWith('.sqlite') ? fileName : `${fileName.replace(/\.sqlite$/, '')}.sqlite`;
        const bytes = db.export();
        const handle = await files.saveAs(bytes, suggested);
        if (handle) {
          set({ fileHandle: handle, fileName: handle.name, dirty: false });
          setStoredFileName(handle.name);
          get().toast('success', `Saved ${handle.name}`);
        } else {
          set({ dirty: false });
          get().toast('success', 'Backup downloaded');
        }
      } catch (err) {
        get().toast('error', `Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    exportXlsx: async () => {
      try {
        const bytes = await exportWorkbookToBytes(get().engine);
        files.downloadBytes(bytes, 'cinematic-resource-plan.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        get().toast('success', 'Excel export complete');
      } catch (err) {
        get().toast('error', `Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    importRpmExport: (mode) => runImport(parseRpmWorkbook, mode),
    importStaffingReport: (mode) => runImport(parseStaffingWorkbook, mode),

    createProject: (input) => {
      const db = get().db!;
      const project = repoCreateProject(db, input);
      persist();
      get().toast('success', `${project.name} created`);
      return project;
    },
    updateProject: (project) => {
      const db = get().db!;
      const original = get().data.projects.find((p) => p.id === project.id);
      const name = freezeRename(db, 'project_name', original, project);
      repoUpdateProject(db, { ...project, name });
      persist();
    },
    deleteProject: (projectId) => {
      const db = get().db!;
      const name = get().data.projects.find((p) => p.id === projectId)?.name ?? 'Project';
      repoDeleteProject(db, projectId);
      persist();
      get().toast('info', `${name} deleted`);
    },

    createPool: (input) => {
      const db = get().db!;
      const pool = repoCreatePool(db, input);
      persist();
      get().toast('success', `${pool.name} pool created`);
      return pool;
    },
    updatePool: (pool) => {
      const db = get().db!;
      const original = get().data.pools.find((p) => p.id === pool.id);
      const name = freezeRename(db, 'pool_name', original, pool);
      repoUpdatePool(db, { ...pool, name });
      persist();
    },
    deletePool: (poolId, cascade) => {
      const db = get().db!;
      const name = get().data.pools.find((p) => p.id === poolId)?.name ?? 'Pool';
      if (cascade) repoDeletePoolCascade(db, poolId);
      else repoDeletePool(db, poolId);
      persist();
      get().toast('info', `${name} pool deleted`);
    },

    createDiscipline: (input) => {
      const db = get().db!;
      const discipline = repoCreateDiscipline(db, input);
      persist();
      get().toast('success', `${discipline.name} discipline created`);
      return discipline;
    },
    updateDiscipline: (discipline) => {
      const db = get().db!;
      const original = get().data.disciplines.find((d) => d.id === discipline.id);
      const name = freezeRename(db, 'discipline_name', original, discipline);
      repoUpdateDiscipline(db, { ...discipline, name });
      persist();
    },
    deleteDiscipline: (disciplineId, cascade) => {
      const db = get().db!;
      const name = get().data.disciplines.find((d) => d.id === disciplineId)?.name ?? 'Discipline';
      if (cascade) repoDeleteDisciplineCascade(db, disciplineId);
      else repoDeleteDiscipline(db, disciplineId);
      persist();
      get().toast('info', `${name} discipline deleted`);
    },

    createPerson: (input) => {
      const db = get().db!;
      const person = repoCreatePerson(db, input);
      persist();
      get().toast('success', `${person.name} added`);
      return person;
    },
    updatePerson: (person) => {
      const db = get().db!;
      const original = get().data.people.find((p) => p.id === person.id);
      const name = freezeRename(db, 'person_name', original, person);
      repoUpdatePerson(db, { ...person, name });
      persist();
    },
    batchUpdatePeople: (personIds, patch) => {
      const db = get().db!;
      const people = get().data.people;
      for (const personId of personIds) {
        const original = people.find((p) => p.id === personId);
        if (!original) continue;
        const updated = { ...original, ...patch };
        const name = freezeRename(db, 'person_name', original, updated);
        repoUpdatePerson(db, { ...updated, name });
      }
      persist();
      get().toast('success', `${personIds.length} person${personIds.length === 1 ? '' : 's'} updated`);
    },
    deletePerson: (personId) => {
      const db = get().db!;
      const name = get().data.people.find((p) => p.id === personId)?.name ?? 'Person';
      repoDeletePerson(db, personId);
      persist();
      get().toast('info', `${name} removed`);
    },

    createCinematic: (input) => {
      const db = get().db!;
      const cinematic = repoCreateCinematic(db, input);
      persist();
      get().toast('success', `${cinematic.name} created`);
      return cinematic;
    },
    updateCinematic: (cinematic) => {
      const db = get().db!;
      repoUpdateCinematic(db, cinematic);
      persist();
    },
    deleteCinematic: (cinematicId) => {
      const db = get().db!;
      const name = get().data.cinematics.find((c) => c.id === cinematicId)?.name ?? 'Cinematic';
      repoDeleteCinematic(db, cinematicId);
      persist();
      get().toast('info', `${name} deleted`);
    },

    createLoq: (input) => {
      const db = get().db!;
      const loq = repoCreateLoq(db, input);
      persist();
      return loq;
    },
    updateLoq: (loq) => {
      const db = get().db!;
      repoUpdateLoq(db, loq);
      persist();
    },
    deleteLoq: (loqId) => {
      const db = get().db!;
      repoDeleteLoq(db, loqId);
      persist();
      get().toast('info', 'LOQ deleted');
    },
    recommitLoq: (loqId, input) => {
      const db = get().db!;
      const loq = get().data.loqs.find((l) => l.id === loqId);
      if (!loq) return;
      const changedBy = useUiStore.getState().producerName.trim() || 'Unknown';
      repoCreateLoqCommitmentEvent(db, {
        loqId,
        committedStart: input.committedStart,
        committedFinish: input.committedFinish,
        changedBy,
        changedAt: new Date().toISOString(),
        reason: input.reason,
        comment: input.comment,
      });
      repoUpdateLoq(db, { ...loq, committedStart: input.committedStart, committedFinish: input.committedFinish });
      persist();
      get().toast('success', `${loq.type} re-committed`);
    },
    declareVariance: (loqId, input) => {
      const db = get().db!;
      const loq = get().data.loqs.find((l) => l.id === loqId);
      if (!loq) return;
      const declaredBy = useUiStore.getState().producerName.trim() || 'Unknown';
      const committedDateAtDeclaration = loq.committedFinish ?? loq.committedStart;
      repoCreateVarianceEvent(db, {
        loqId,
        category: input.category,
        comment: input.comment,
        declaredBy,
        declaredAt: new Date().toISOString(),
        committedDateAtDeclaration,
        forecastDateAtDeclaration: input.expectedFinish,
        deltaDays: committedDateAtDeclaration ? isoDiffDays(committedDateAtDeclaration, input.expectedFinish) : 0,
      });
      persist();
      get().toast('success', `Variance declared on ${loq.type}`);
    },

    createLoqResource: (input) => {
      const db = get().db!;
      const resource = repoCreateLoqResource(db, input);
      persist();
      return resource;
    },
    updateLoqResource: (resource) => {
      const db = get().db!;
      repoUpdateLoqResource(db, resource);
      persist();
    },
    deleteLoqResource: (resourceId) => {
      const db = get().db!;
      repoDeleteLoqResource(db, resourceId);
      persist();
    },

    setRequirement: (projectId, poolId, period, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetRequirementAllocation(db, req.id, period, clamped);
      extendProjectDatesToCover(db, projectId, [period], clamped);
      persist();
    },
    setRequirementRange: (projectId, poolId, periods, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetRequirementAllocations(db, req.id, periods, clamped);
      extendProjectDatesToCover(db, projectId, periods, clamped);
      persist();
    },
    setDisciplineRequirement: (projectId, disciplineId, period, fte) => {
      const db = get().db!;
      const poolId = resolveGenericPoolId(db, disciplineId);
      if (!poolId) return;
      const clamped = Math.max(0, fte);
      const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetRequirementAllocation(db, req.id, period, clamped);
      extendProjectDatesToCover(db, projectId, [period], clamped);
      persist();
    },
    setDisciplineRequirementRange: (projectId, disciplineId, periods, fte) => {
      const db = get().db!;
      const poolId = resolveGenericPoolId(db, disciplineId);
      if (!poolId) return;
      const clamped = Math.max(0, fte);
      const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetRequirementAllocations(db, req.id, periods, clamped);
      extendProjectDatesToCover(db, projectId, periods, clamped);
      persist();
    },
    setPersonAssignment: (personId, projectId, period, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const asn = getOrCreatePersonAssignment(db, personId, projectId, BASE_SCENARIO_ID);
      repoSetPersonAssignmentAllocation(db, asn.id, period, clamped);
      extendProjectDatesToCover(db, projectId, [period], clamped);
      persist();
      warnIfOverAllocated(personId, [period]);
    },
    setPersonAssignmentRange: (personId, projectId, periods, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const asn = getOrCreatePersonAssignment(db, personId, projectId, BASE_SCENARIO_ID);
      repoSetPersonAssignmentAllocations(db, asn.id, periods, clamped);
      extendProjectDatesToCover(db, projectId, periods, clamped);
      persist();
      warnIfOverAllocated(personId, periods);
    },
    clearRequirementPool: (projectId, poolId) => {
      const db = get().db!;
      const req = get().data.requirements.find((r) => r.projectId === projectId && r.poolId === poolId);
      if (req) repoDeleteRequirement(db, req.id);
      persist();
    },
    clearPersonAssignment: (personId, projectId) => {
      const db = get().db!;
      const asn = get().data.personAssignments.find((a) => a.personId === personId && a.projectId === projectId);
      if (asn) repoDeletePersonAssignment(db, asn.id);
      persist();
    },
    feedRequirementsFromAssignments: (projectId, mode) => {
      const db = get().db!;
      const project = get().data.projects.find((p) => p.id === projectId);
      const changed = feedProjectRequirements(db, get().engine, projectId, mode);
      persist();
      get().toast(changed > 0 ? 'success' : 'info', changed > 0
        ? `${project?.name ?? 'Project'}: ${changed} requirement${changed === 1 ? '' : 's'} updated from assignments`
        : `${project?.name ?? 'Project'}: requirements already match assignments`);
    },
    feedAllRequirementsFromAssignments: (mode) => {
      const db = get().db!;
      const engine = get().engine;
      const projects = get().data.projects;
      let changed = 0;
      for (const project of projects) changed += feedProjectRequirements(db, engine, project.id, mode);
      persist();
      get().toast(changed > 0 ? 'success' : 'info', changed > 0
        ? `${changed} requirement${changed === 1 ? '' : 's'} updated from assignments across ${projects.length} project${projects.length === 1 ? '' : 's'}`
        : 'Requirements already match assignments everywhere');
    },

    shiftProjectAllocations: (projectId, monthDelta) => {
      if (monthDelta === 0) return;
      const db = get().db!;
      const data = get().data;
      let changed = 0;

      for (const req of data.requirements.filter((r) => r.projectId === projectId && r.scenarioId === BASE_SCENARIO_ID)) {
        const allocs = data.requirementAllocations.filter((a) => a.requirementId === req.id && Math.abs(a.fte) > 0.001);
        if (allocs.length === 0) continue;
        const shifted = allocs.map((a) => ({ period: addMonths(a.period, monthDelta), fte: a.fte }));
        for (const a of allocs) repoSetRequirementAllocation(db, req.id, a.period, 0);
        for (const s of shifted) repoSetRequirementAllocation(db, req.id, s.period, s.fte);
        changed += allocs.length;
      }
      for (const asn of data.personAssignments.filter((a) => a.projectId === projectId && a.scenarioId === BASE_SCENARIO_ID)) {
        const allocs = data.personAssignmentAllocations.filter((a) => a.personAssignmentId === asn.id && Math.abs(a.fte) > 0.001);
        if (allocs.length === 0) continue;
        const shifted = allocs.map((a) => ({ period: addMonths(a.period, monthDelta), fte: a.fte }));
        for (const a of allocs) repoSetPersonAssignmentAllocation(db, asn.id, a.period, 0);
        for (const s of shifted) repoSetPersonAssignmentAllocation(db, asn.id, s.period, s.fte);
        changed += allocs.length;
      }
      persist();
      get().toast(changed > 0 ? 'success' : 'info', changed > 0
        ? `Moved ${changed} allocation${changed === 1 ? '' : 's'} with the project`
        : 'Nothing to move — the project had no allocations');
    },
    autofillProjectExtension: (projectId, fromPeriod, toPeriod, opts) => {
      const db = get().db!;
      const data = get().data;
      const addedPeriods = periodRange(fromPeriod, toPeriod);
      if (addedPeriods.length === 0) return;
      const lastPeriod = addMonths(fromPeriod, -1);
      let changed = 0;

      if (opts.needs) {
        for (const req of data.requirements.filter((r) => r.projectId === projectId && r.scenarioId === BASE_SCENARIO_ID)) {
          const last = data.requirementAllocations.find((a) => a.requirementId === req.id && a.period === lastPeriod);
          if (!last || last.fte <= 0.001) continue;
          repoSetRequirementAllocations(db, req.id, addedPeriods, last.fte);
          changed += addedPeriods.length;
        }
      }
      if (opts.assignments) {
        for (const asn of data.personAssignments.filter((a) => a.projectId === projectId && a.scenarioId === BASE_SCENARIO_ID)) {
          const last = data.personAssignmentAllocations.find((a) => a.personAssignmentId === asn.id && a.period === lastPeriod);
          if (!last || last.fte <= 0.001) continue;
          repoSetPersonAssignmentAllocations(db, asn.id, addedPeriods, last.fte);
          changed += addedPeriods.length;
        }
      }
      persist();
      get().toast(changed > 0 ? 'success' : 'info', changed > 0
        ? `Autofilled ${changed} cell${changed === 1 ? '' : 's'} from ${formatPeriodLabel(lastPeriod)}`
        : `Nothing to autofill from ${formatPeriodLabel(lastPeriod)}`);
    },

    setPoolDiscipline: (poolName, disciplineName) => {
      const db = get().db!;
      repoUpsertStructureOverride(db, 'pool_discipline', normalizeKey(poolName), normalizeKey(disciplineName));
      persist();
    },
    setPersonPool: (personName, poolName) => {
      const db = get().db!;
      repoUpsertStructureOverride(db, 'person_pool', normalizeKey(personName), normalizeKey(poolName));
      persist();
    },
    setPoolPersonPool: (sourcePoolName, targetPoolName) => {
      const db = get().db!;
      repoUpsertStructureOverride(db, 'pool_person_pool', normalizeKey(sourcePoolName), normalizeKey(targetPoolName));
      persist();
    },
    setPersonDiscipline: (personName, disciplineName) => {
      const db = get().db!;
      repoUpsertStructureOverride(db, 'person_discipline', normalizeKey(personName), normalizeKey(disciplineName));
      persist();
    },
    clearOverride: (overrideId) => {
      const db = get().db!;
      repoDeleteStructureOverride(db, overrideId);
      persist();
    },
    clearOverrideByKey: (kind, sourceKey) => {
      const db = get().db!;
      repoDeleteStructureOverrideByKey(db, kind, sourceKey);
      persist();
    },
  };
});
