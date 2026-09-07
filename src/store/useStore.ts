import { create } from 'zustand';
import { PlannerDatabase } from '../db/database';
import {
  loadPlanningData, BASE_SCENARIO_ID,
  createProject as repoCreateProject, updateProject as repoUpdateProject, deleteProject as repoDeleteProject,
  createPool as repoCreatePool, updatePool as repoUpdatePool, deletePool as repoDeletePool,
  setPoolCapacityOverride as repoSetPoolCapacityOverride,
  getOrCreateRequirement, setRequirementAllocation as repoSetRequirementAllocation, deleteRequirement as repoDeleteRequirement,
  createDiscipline as repoCreateDiscipline, updateDiscipline as repoUpdateDiscipline, deleteDiscipline as repoDeleteDiscipline,
  createPerson as repoCreatePerson, updatePerson as repoUpdatePerson, deletePerson as repoDeletePerson,
  getOrCreatePersonAssignment, setPersonAssignmentAllocation as repoSetPersonAssignmentAllocation, deletePersonAssignment as repoDeletePersonAssignment,
} from '../db/repository';
import { applyRpmImport, type ImportMode } from '../db/applyImport';
import { seedDemoData } from '../db/seed';
import { getStoredFileName, loadAutosave, saveAutosave, setStoredFileName } from '../persistence/indexeddb';
import * as files from '../persistence/files';
import { exportWorkbookToBytes } from '../export/xlsx';
import { parseRpmWorkbook, type ImportReport } from '../import/rpmImport';
import { PlanningEngine } from '../engine/planning';
import type { Discipline, PlanningData, Period, Person, Project, ResourcePool } from '../domain/types';
import { emptyPlanningData } from '../domain/types';

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
  deletePerson: (personId: string) => void;

  setRequirement: (projectId: string, poolId: string, period: Period, fte: number) => void;
  setPersonAssignment: (personId: string, projectId: string, period: Period, fte: number) => void;
  clearRequirementPool: (projectId: string, poolId: string) => void;
  clearPersonAssignment: (personId: string, projectId: string) => void;
}

function nextToastId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useStore = create<StoreState>((set, get) => {
  function reload(db: PlannerDatabase): void {
    const data = loadPlanningData(db);
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
        const normalized = await parseRpmWorkbook(opened.buffer, opened.name);

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
      repoUpdateProject(db, project);
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
      repoUpdatePool(db, pool);
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
      repoUpdateDiscipline(db, discipline);
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
      repoUpdatePerson(db, person);
      persist();
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
    setPersonAssignment: (personId, projectId, period, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const asn = getOrCreatePersonAssignment(db, personId, projectId, BASE_SCENARIO_ID);
      repoSetPersonAssignmentAllocation(db, asn.id, period, clamped);
      persist();
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
  };
});
