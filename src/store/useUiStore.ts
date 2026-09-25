import { create } from 'zustand';
import type { GlobalFilter } from '../domain/filter';
import { EMPTY_GLOBAL_FILTER } from '../domain/filter';
import type { Period } from '../domain/types';

export type ViewName = 'dashboard' | 'timeline' | 'projects' | 'team' | 'people' | 'settings' | 'project-detail' | 'person-detail' | 'cinematic-detail';
export type PeopleMode = 'availability' | 'assignments';
/** Watchtower's Production/Staffing switch inside a Project — Production is the prototype's
 * Control Room/Matrix, Staffing is the pre-existing requirement/assignment timeline. */
export type ProjectView = 'production' | 'staffing';
export type ProductionScreen = 'control' | 'matrix';
/** "Mocap batch" grouping from the prototype has no backing data in this schema — omitted. */
export type MatrixGroupBy = 'none' | 'health' | 'status' | 'discipline';
/** Percentage zoom level, 10-800. 100 = the previous "Compact" scale (3px/day). Raised from 200 to
 * 800 (Phase 3) so day granularity (>=18px/day, i.e. zoom >= 600) is actually legible. */
export type TimelineZoom = number;
export const TIMELINE_ZOOM_MIN = 10;
export const TIMELINE_ZOOM_MAX = 800;
export const TIMELINE_ZOOM_DEFAULT = 100;

const COLLAPSE_STORAGE_KEY = 'cine-planner-collapse';
const TIMELINE_FILTERS_KEY = 'cine-planner-timeline-filters';
const GLOBAL_FILTER_KEY = 'cine-planner-global-filter';
const PEOPLE_MODE_KEY = 'cine-planner-people-mode';
const PRODUCER_NAME_KEY = 'cine-planner-producer-name';
const PROJECT_VIEW_KEY = 'cine-planner-project-view';
const PRODUCTION_SCREEN_KEY = 'cine-planner-production-screen';
const MATRIX_GROUP_KEY = 'cine-planner-matrix-group';
const MATRIX_COLS_KEY = 'cine-planner-matrix-hidden-cols';

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

interface TimelineFilters {
  zoom: TimelineZoom;
  search: string;
  poolFilter: string[] | null;
  /** null = auto-computed window (today ± data padding). Set = user-picked manual bounds. */
  from: Period | null;
  to: Period | null;
}

function loadTimelineFilters(): TimelineFilters {
  const fallback: TimelineFilters = { zoom: TIMELINE_ZOOM_DEFAULT, search: '', poolFilter: null, from: null, to: null };
  try {
    const raw = localStorage.getItem(TIMELINE_FILTERS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const zoom = typeof parsed.zoom === 'number' && parsed.zoom >= TIMELINE_ZOOM_MIN && parsed.zoom <= TIMELINE_ZOOM_MAX
      ? parsed.zoom
      : TIMELINE_ZOOM_DEFAULT;
    return {
      zoom,
      search: typeof parsed.search === 'string' ? parsed.search : '',
      poolFilter: Array.isArray(parsed.poolFilter) ? parsed.poolFilter : null,
      from: typeof parsed.from === 'string' ? parsed.from : null,
      to: typeof parsed.to === 'string' ? parsed.to : null,
    };
  } catch {
    return fallback;
  }
}

function saveTimelineFilters(filters: TimelineFilters): void {
  localStorage.setItem(TIMELINE_FILTERS_KEY, JSON.stringify(filters));
}

interface GlobalFilterPrefs {
  filter: GlobalFilter;
}

function loadGlobalFilterPrefs(): GlobalFilterPrefs {
  const fallback: GlobalFilterPrefs = { filter: EMPTY_GLOBAL_FILTER };
  try {
    const raw = localStorage.getItem(GLOBAL_FILTER_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const f = parsed.filter;
    const filter: GlobalFilter = {
      sites: Array.isArray(f?.sites) ? f.sites : null,
      teams: Array.isArray(f?.teams) ? f.teams : null,
      disciplineIds: Array.isArray(f?.disciplineIds) ? f.disciplineIds : null,
    };
    return { filter };
  } catch {
    return fallback;
  }
}

function saveGlobalFilterPrefs(prefs: GlobalFilterPrefs): void {
  localStorage.setItem(GLOBAL_FILTER_KEY, JSON.stringify(prefs));
}

function loadPeopleMode(): PeopleMode {
  try {
    return localStorage.getItem(PEOPLE_MODE_KEY) === 'assignments' ? 'assignments' : 'availability';
  } catch {
    return 'availability';
  }
}

function loadProducerName(): string {
  try {
    return localStorage.getItem(PRODUCER_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function loadProjectView(): ProjectView {
  try {
    return localStorage.getItem(PROJECT_VIEW_KEY) === 'staffing' ? 'staffing' : 'production';
  } catch {
    return 'production';
  }
}

function loadProductionScreen(): ProductionScreen {
  try {
    return localStorage.getItem(PRODUCTION_SCREEN_KEY) === 'matrix' ? 'matrix' : 'control';
  } catch {
    return 'control';
  }
}

function loadMatrixGroupBy(): MatrixGroupBy {
  try {
    const raw = localStorage.getItem(MATRIX_GROUP_KEY);
    return raw === 'health' || raw === 'status' || raw === 'discipline' ? raw : 'none';
  } catch {
    return 'none';
  }
}

function loadMatrixHiddenCols(): string[] {
  try {
    const raw = localStorage.getItem(MATRIX_COLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

interface UiState {
  view: ViewName;
  selectedProjectId: string | null;
  selectedPersonId: string | null;
  selectedCinematicId: string | null;
  navigate: (view: ViewName) => void;
  openProject: (projectId: string) => void;
  backToProjects: () => void;
  openPerson: (personId: string) => void;
  backToTeam: () => void;
  /** Drill in from ProjectDetail — keeps selectedProjectId so backToProject can return there. */
  openCinematic: (cinematicId: string) => void;
  backToProject: () => void;

  /** Keyed by a stable scope string (e.g. "team:disc:<id>"). true = collapsed. */
  collapsed: Record<string, boolean>;
  isCollapsed: (key: string) => boolean;
  toggleCollapse: (key: string) => void;
  setCollapsed: (key: string, value: boolean) => void;
  /** Batches many keys into a single localStorage write, e.g. for "expand all" / "collapse all". */
  setManyCollapsed: (keys: string[], value: boolean) => void;

  timelineZoom: TimelineZoom;
  timelineSearch: string;
  /** null = show all pools. Pool IDs regenerate on a "replace" RPM re-import, so a stale filter falls back to "all". */
  timelinePoolFilter: string[] | null;
  /** null = auto-computed window. Set = user override via the From/To pickers. */
  timelineFrom: Period | null;
  timelineTo: Period | null;
  setTimelineZoom: (zoom: TimelineZoom) => void;
  setTimelineSearch: (search: string) => void;
  setTimelinePoolFilter: (poolFilter: string[] | null) => void;
  setTimelineWindow: (from: Period | null, to: Period | null) => void;

  /** Shared across Dashboard/Team/People — recomputes the engine, not just row visibility. */
  globalFilter: GlobalFilter;
  setGlobalFilter: (filter: GlobalFilter) => void;

  /** Which of the two People sub-views (Availability / Assignments) is showing. */
  peopleMode: PeopleMode;
  setPeopleMode: (mode: PeopleMode) => void;

  /** Stamped onto loq_commitment_events.changed_by / variance_events.declared_by. A single global
   * name, not a per-action prompt — good enough until a real Settings/user-account screen exists. */
  producerName: string;
  setProducerName: (name: string) => void;

  /** Ephemeral — not persisted. Global "jump to…" search opened with Ctrl/Cmd+K. */
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  /** Which of ProjectDetail's two top-level tabs is showing. */
  projectView: ProjectView;
  setProjectView: (view: ProjectView) => void;
  /** Which Production sub-screen (only relevant when projectView === 'production'). */
  productionScreen: ProductionScreen;
  setProductionScreen: (screen: ProductionScreen) => void;
  /** Cinematics Matrix grouping + column visibility — the only Matrix prefs the prototype itself
   * persists (search/filters/sort reset per session, kept as local component state). */
  matrixGroupBy: MatrixGroupBy;
  setMatrixGroupBy: (groupBy: MatrixGroupBy) => void;
  matrixHiddenDisciplineIds: string[];
  setMatrixHiddenDisciplineIds: (ids: string[]) => void;
}

const initialTimelineFilters = loadTimelineFilters();
const initialGlobalFilterPrefs = loadGlobalFilterPrefs();

export const useUiStore = create<UiState>((set, get) => ({
  view: 'dashboard',
  selectedProjectId: null,
  selectedPersonId: null,
  selectedCinematicId: null,
  navigate: (view) => set({ view, selectedProjectId: null, selectedPersonId: null, selectedCinematicId: null }),
  openProject: (projectId) => set({ view: 'project-detail', selectedProjectId: projectId, selectedPersonId: null, selectedCinematicId: null }),
  backToProjects: () => set({ view: 'projects', selectedProjectId: null, selectedCinematicId: null }),
  openPerson: (personId) => set({ view: 'person-detail', selectedPersonId: personId, selectedProjectId: null }),
  backToTeam: () => set({ view: 'team', selectedPersonId: null }),
  openCinematic: (cinematicId) => set({ view: 'cinematic-detail', selectedCinematicId: cinematicId }),
  backToProject: () => set({ view: 'project-detail', selectedCinematicId: null }),

  collapsed: loadCollapsed(),
  isCollapsed: (key) => get().collapsed[key] === true,
  toggleCollapse: (key) => {
    const next = { ...get().collapsed, [key]: !get().collapsed[key] };
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
    set({ collapsed: next });
  },
  setCollapsed: (key, value) => {
    const next = { ...get().collapsed, [key]: value };
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
    set({ collapsed: next });
  },
  setManyCollapsed: (keys, value) => {
    const next = { ...get().collapsed };
    for (const key of keys) next[key] = value;
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
    set({ collapsed: next });
  },

  timelineZoom: initialTimelineFilters.zoom,
  timelineSearch: initialTimelineFilters.search,
  timelinePoolFilter: initialTimelineFilters.poolFilter,
  timelineFrom: initialTimelineFilters.from,
  timelineTo: initialTimelineFilters.to,
  setTimelineZoom: (zoom) => {
    const clamped = Math.min(TIMELINE_ZOOM_MAX, Math.max(TIMELINE_ZOOM_MIN, zoom));
    const filters = { zoom: clamped, search: get().timelineSearch, poolFilter: get().timelinePoolFilter, from: get().timelineFrom, to: get().timelineTo };
    saveTimelineFilters(filters);
    set({ timelineZoom: clamped });
  },
  setTimelineSearch: (search) => {
    const filters = { zoom: get().timelineZoom, search, poolFilter: get().timelinePoolFilter, from: get().timelineFrom, to: get().timelineTo };
    saveTimelineFilters(filters);
    set({ timelineSearch: search });
  },
  setTimelinePoolFilter: (poolFilter) => {
    const filters = { zoom: get().timelineZoom, search: get().timelineSearch, poolFilter, from: get().timelineFrom, to: get().timelineTo };
    saveTimelineFilters(filters);
    set({ timelinePoolFilter: poolFilter });
  },
  setTimelineWindow: (from, to) => {
    const filters = { zoom: get().timelineZoom, search: get().timelineSearch, poolFilter: get().timelinePoolFilter, from, to };
    saveTimelineFilters(filters);
    set({ timelineFrom: from, timelineTo: to });
  },

  globalFilter: initialGlobalFilterPrefs.filter,
  setGlobalFilter: (filter) => {
    saveGlobalFilterPrefs({ filter });
    set({ globalFilter: filter });
  },

  peopleMode: loadPeopleMode(),
  setPeopleMode: (mode) => {
    localStorage.setItem(PEOPLE_MODE_KEY, mode);
    set({ peopleMode: mode });
  },

  producerName: loadProducerName(),
  setProducerName: (name) => {
    localStorage.setItem(PRODUCER_NAME_KEY, name);
    set({ producerName: name });
  },

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  projectView: loadProjectView(),
  setProjectView: (view) => {
    localStorage.setItem(PROJECT_VIEW_KEY, view);
    set({ projectView: view });
  },
  productionScreen: loadProductionScreen(),
  setProductionScreen: (screen) => {
    localStorage.setItem(PRODUCTION_SCREEN_KEY, screen);
    set({ productionScreen: screen });
  },
  matrixGroupBy: loadMatrixGroupBy(),
  setMatrixGroupBy: (groupBy) => {
    localStorage.setItem(MATRIX_GROUP_KEY, groupBy);
    set({ matrixGroupBy: groupBy });
  },
  matrixHiddenDisciplineIds: loadMatrixHiddenCols(),
  setMatrixHiddenDisciplineIds: (ids) => {
    localStorage.setItem(MATRIX_COLS_KEY, JSON.stringify(ids));
    set({ matrixHiddenDisciplineIds: ids });
  },
}));
