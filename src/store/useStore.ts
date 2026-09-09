import { create } from 'zustand';
import { PlannerDatabase } from '../db/database';
import {
  loadPlanningData, BASE_SCENARIO_ID,
  createProject as repoCreateProject, updateProject as repoUpdateProject, deleteProject as repoDeleteProject,
  createPool as repoCreatePool, updatePool as repoUpdatePool, deletePool as repoDeletePool,
  setPoolCapacityOverride as repoSetPoolCapacityOverride,
  getOrCreateRequirement, setRequirementAllocation as repoSetRequirementAllocation, setRequirementAllocations as repoSetRequirementAllocations, deleteRequirement as repoDeleteRequirement,
  createDiscipline as repoCreateDiscipline, updateDiscipline as repoUpdateDiscipline, deleteDiscipline as repoDeleteDiscipline,
  createPerson as repoCreatePerson, updatePerson as repoUpdatePerson, deletePerson as repoDeletePerson,
  getOrCreatePersonAssignment, setPersonAssignmentAllocation as repoSetPersonAssignmentAllocation, setPersonAssignmentAllocations as repoSetPersonAssignmentAllocations, deletePersonAssignment as repoDeletePersonAssignment,
  upsertStructureOverride as repoUpsertStructureOverride, deleteStructureOverride as repoDeleteStructureOverride,
  deleteStructureOverrideByKey as repoDeleteStructureOverrideByKey,
} from '../db/repository';
import { applyRpmImport, type ImportMode } from '../db/applyImport';
import { seedDemoData } from '../db/seed';
import { getStoredFileName, loadAutosave, saveAutosave, setStoredFileName } from '../persistence/indexeddb';
import * as files from '../persistence/files';
import { exportWorkbookToBytes } from '../export/xlsx';
import type { ImportReport } from '../import/rpmImport';
import { parseAnyWorkbook } from '../import/staffingImport';
import { PlanningEngine, round2 } from '../engine/planning';
import type { Discipline, PlanningData, Period, Person, Project, ResourcePool, StructureOverrideKind } from '../domain/types';
import { emptyPlanningData } from '../domain/types';
import { applyStructureOverrides } from '../domain/overrides';
import { normalizeKey, genericPoolName } from '../domain/identity';
import { formatPeriodLabel } from '../domain/periods';

export type ToastKind = 'success' | 'error' | 'info';

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
  importRpm: (mode: ImportMode) => Promise<ImportReport | null>;

  createProject: (input: Omit<Project, 'id' | 'sortOrder'>) => Project;
  updateProject: (project: Project) => void;
  deleteProject: (projectId: string) => void;

  createPool: (input: Omit<ResourcePool, 'id' | 'sortOrder'>) => ResourcePool;
  updatePool: (pool: ResourcePool) => void;
  deletePool: (poolId: string) => void;
  setPoolCapacityOverride: (poolId: string, period: Period, capacityFte: number | null) => void;

  createDiscipline: (input: Omit<Discipline, 'id' | 'sortOrder'>) => Discipline;
  updateDiscipline: (discipline: Discipline) => void;
  deleteDiscipline: (disciplineId: string) => void;

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

  setPoolDiscipline: (poolName: string, disciplineName: string) => void;
  setPersonPool: (personName: string, poolName: string) => void;
  setPoolPersonPool: (sourcePoolName: string, targetPoolName: string) => void;
  clearOverride: (overrideId: string) => void;
}

function nextToastId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useStore = create<StoreState>((set, get) => {
  function reload(db: PlannerDatabase): void {
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

  /** Finds (or lazily creates) the hidden pool that carries a discipline's "N people, no role picked" requirement. */
  function resolveGenericPoolId(db: PlannerDatabase, disciplineId: string): string | null {
    const discipline = get().data.disciplines.find((d) => d.id === disciplineId);
    if (!discipline) return null;
    const name = genericPoolName(discipline.name);
    const existing = get().data.pools.find((p) => p.disciplineId === disciplineId && normalizeKey(p.name) === normalizeKey(name));
    if (existing) return existing.id;
    const pool = repoCreatePool(db, { name, disciplineId, color: discipline.color, capacityFte: 0 });
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

    importRpm: async (mode) => {
      try {
        const opened = await files.openXlsxFile();
        if (!opened) return null;
        const normalized = await parseAnyWorkbook(opened.buffer, opened.name);

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
    },

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
    deletePool: (poolId) => {
      const db = get().db!;
      const name = get().data.pools.find((p) => p.id === poolId)?.name ?? 'Pool';
      repoDeletePool(db, poolId);
      persist();
      get().toast('info', `${name} pool deleted`);
    },
    setPoolCapacityOverride: (poolId, period, capacityFte) => {
      const db = get().db!;
      repoSetPoolCapacityOverride(db, poolId, period, capacityFte);
      persist();
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
    deleteDiscipline: (disciplineId) => {
      const db = get().db!;
      const name = get().data.disciplines.find((d) => d.id === disciplineId)?.name ?? 'Discipline';
      repoDeleteDiscipline(db, disciplineId);
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

    setRequirement: (projectId, poolId, period, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetRequirementAllocation(db, req.id, period, clamped);
      persist();
    },
    setRequirementRange: (projectId, poolId, periods, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetRequirementAllocations(db, req.id, periods, clamped);
      persist();
    },
    setDisciplineRequirement: (projectId, disciplineId, period, fte) => {
      const db = get().db!;
      const poolId = resolveGenericPoolId(db, disciplineId);
      if (!poolId) return;
      const clamped = Math.max(0, fte);
      const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetRequirementAllocation(db, req.id, period, clamped);
      persist();
    },
    setDisciplineRequirementRange: (projectId, disciplineId, periods, fte) => {
      const db = get().db!;
      const poolId = resolveGenericPoolId(db, disciplineId);
      if (!poolId) return;
      const clamped = Math.max(0, fte);
      const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetRequirementAllocations(db, req.id, periods, clamped);
      persist();
    },
    setPersonAssignment: (personId, projectId, period, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const asn = getOrCreatePersonAssignment(db, personId, projectId, BASE_SCENARIO_ID);
      repoSetPersonAssignmentAllocation(db, asn.id, period, clamped);
      persist();
      warnIfOverAllocated(personId, [period]);
    },
    setPersonAssignmentRange: (personId, projectId, periods, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const asn = getOrCreatePersonAssignment(db, personId, projectId, BASE_SCENARIO_ID);
      repoSetPersonAssignmentAllocations(db, asn.id, periods, clamped);
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
    clearOverride: (overrideId) => {
      const db = get().db!;
      repoDeleteStructureOverride(db, overrideId);
      persist();
    },
  };
});
