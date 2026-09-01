import { create } from 'zustand';
import { PlannerDatabase } from '../db/database';
import { loadPlanningData, BASE_SCENARIO_ID, createProject as repoCreateProject, updateProject as repoUpdateProject, deleteProject as repoDeleteProject, createPool as repoCreatePool, updatePool as repoUpdatePool, deletePool as repoDeletePool, setPoolCapacityOverride as repoSetPoolCapacityOverride, getOrCreateRequirement, setRequirementAllocation as repoSetRequirementAllocation, deleteRequirement as repoDeleteRequirement, getOrCreateAssignment, setAssignmentAllocation as repoSetAssignmentAllocation, deleteAssignment as repoDeleteAssignment } from '../db/repository';
import { seedDemoData } from '../db/seed';
import { getStoredFileName, loadAutosave, saveAutosave, setStoredFileName } from '../persistence/indexeddb';
import * as files from '../persistence/files';
import { exportWorkbookToBytes } from '../export/xlsx';
import { PlanningEngine } from '../engine/planning';
import type { PlanningData, Period, Project, ResourcePool } from '../domain/types';
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

  init: () => Promise<void>;
  toast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: string) => void;
  toggleTheme: () => void;

  newDatabase: (seed: boolean) => Promise<void>;
  openDatabase: () => Promise<void>;
  saveDatabase: () => Promise<void>;
  saveDatabaseAs: () => Promise<void>;
  exportXlsx: () => Promise<void>;

  createProject: (input: Omit<Project, 'id' | 'sortOrder'>) => Project;
  updateProject: (project: Project) => void;
  deleteProject: (projectId: string) => void;

  createPool: (input: Omit<ResourcePool, 'id' | 'sortOrder'>) => ResourcePool;
  updatePool: (pool: ResourcePool) => void;
  deletePool: (poolId: string) => void;
  setPoolCapacityOverride: (poolId: string, period: Period, capacityFte: number | null) => void;

  setRequirement: (projectId: string, poolId: string, period: Period, fte: number) => void;
  setAssignment: (projectId: string, poolId: string, period: Period, fte: number) => void;
  clearRequirementPool: (projectId: string, poolId: string) => void;
  clearAssignmentPool: (projectId: string, poolId: string) => void;
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

    setRequirement: (projectId, poolId, period, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const req = getOrCreateRequirement(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetRequirementAllocation(db, req.id, period, clamped);
      persist();
    },
    setAssignment: (projectId, poolId, period, fte) => {
      const db = get().db!;
      const clamped = Math.max(0, fte);
      const asn = getOrCreateAssignment(db, projectId, poolId, BASE_SCENARIO_ID);
      repoSetAssignmentAllocation(db, asn.id, period, clamped);
      persist();
    },
    clearRequirementPool: (projectId, poolId) => {
      const db = get().db!;
      const req = get().data.requirements.find((r) => r.projectId === projectId && r.poolId === poolId);
      if (req) repoDeleteRequirement(db, req.id);
      persist();
    },
    clearAssignmentPool: (projectId, poolId) => {
      const db = get().db!;
      const asn = get().data.assignments.find((a) => a.projectId === projectId && a.poolId === poolId);
      if (asn) repoDeleteAssignment(db, asn.id);
      persist();
    },
  };
});
