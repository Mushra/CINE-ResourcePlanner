import { create } from 'zustand';
import type { GlobalFilter } from '../domain/filter';
import { EMPTY_GLOBAL_FILTER } from '../domain/filter';

export type ViewName = 'dashboard' | 'timeline' | 'projects' | 'team' | 'people' | 'project-detail';
export type PeopleMode = 'availability' | 'assignments';
export type TimelineZoom = 'compact' | 'comfortable' | 'wide';
export type HorizonMonths = 3 | 6 | 12;

const COLLAPSE_STORAGE_KEY = 'cine-planner-collapse';
const TIMELINE_FILTERS_KEY = 'cine-planner-timeline-filters';
const GLOBAL_FILTER_KEY = 'cine-planner-global-filter';
const BESOINS_PREFS_KEY = 'cine-planner-besoins-prefs';
const PEOPLE_MODE_KEY = 'cine-planner-people-mode';

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
}

function loadTimelineFilters(): TimelineFilters {
  const fallback: TimelineFilters = { zoom: 'comfortable', search: '', poolFilter: null };
  try {
    const raw = localStorage.getItem(TIMELINE_FILTERS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    return {
      zoom: parsed.zoom === 'compact' || parsed.zoom === 'wide' ? parsed.zoom : 'comfortable',
      search: typeof parsed.search === 'string' ? parsed.search : '',
      poolFilter: Array.isArray(parsed.poolFilter) ? parsed.poolFilter : null,
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
  horizonMonths: HorizonMonths;
}

function loadGlobalFilterPrefs(): GlobalFilterPrefs {
  const fallback: GlobalFilterPrefs = { filter: EMPTY_GLOBAL_FILTER, horizonMonths: 6 };
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
    const horizonMonths: HorizonMonths = parsed.horizonMonths === 3 || parsed.horizonMonths === 12 ? parsed.horizonMonths : 6;
    return { filter, horizonMonths };
  } catch {
    return fallback;
  }
}

function saveGlobalFilterPrefs(prefs: GlobalFilterPrefs): void {
  localStorage.setItem(GLOBAL_FILTER_KEY, JSON.stringify(prefs));
}

export type BesoinsMode = 'table' | 'timeline';
export type BesoinsGranularity = 'month' | 'year';

interface BesoinsPrefs {
  mode: BesoinsMode;
  granularity: BesoinsGranularity;
  assignationsGranularity: BesoinsGranularity;
}

function loadBesoinsPrefs(): BesoinsPrefs {
  const fallback: BesoinsPrefs = { mode: 'table', granularity: 'month', assignationsGranularity: 'month' };
  try {
    const raw = localStorage.getItem(BESOINS_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    return {
      mode: parsed.mode === 'timeline' ? 'timeline' : 'table',
      granularity: parsed.granularity === 'year' ? 'year' : 'month',
      assignationsGranularity: parsed.assignationsGranularity === 'year' ? 'year' : 'month',
    };
  } catch {
    return fallback;
  }
}

function saveBesoinsPrefs(prefs: BesoinsPrefs): void {
  localStorage.setItem(BESOINS_PREFS_KEY, JSON.stringify(prefs));
}

function loadPeopleMode(): PeopleMode {
  try {
    return localStorage.getItem(PEOPLE_MODE_KEY) === 'assignments' ? 'assignments' : 'availability';
  } catch {
    return 'availability';
  }
}

interface UiState {
  view: ViewName;
  selectedProjectId: string | null;
  navigate: (view: ViewName) => void;
  openProject: (projectId: string) => void;
  backToProjects: () => void;

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
  setTimelineZoom: (zoom: TimelineZoom) => void;
  setTimelineSearch: (search: string) => void;
  setTimelinePoolFilter: (poolFilter: string[] | null) => void;

  /** Shared across Dashboard/Team/People — recomputes the engine, not just row visibility. */
  globalFilter: GlobalFilter;
  horizonMonths: HorizonMonths;
  setGlobalFilter: (filter: GlobalFilter) => void;
  setHorizonMonths: (months: HorizonMonths) => void;

  /** Which of the two People sub-views (Availability / Assignments) is showing. */
  peopleMode: PeopleMode;
  setPeopleMode: (mode: PeopleMode) => void;

  besoinsMode: BesoinsMode;
  besoinsGranularity: BesoinsGranularity;
  assignationsGranularity: BesoinsGranularity;
  setBesoinsMode: (mode: BesoinsMode) => void;
  setBesoinsGranularity: (granularity: BesoinsGranularity) => void;
  setAssignationsGranularity: (granularity: BesoinsGranularity) => void;

  /** Ephemeral — not persisted. Global "jump to…" search opened with Ctrl/Cmd+K. */
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

const initialTimelineFilters = loadTimelineFilters();
const initialGlobalFilterPrefs = loadGlobalFilterPrefs();
const initialBesoinsPrefs = loadBesoinsPrefs();

export const useUiStore = create<UiState>((set, get) => ({
  view: 'dashboard',
  selectedProjectId: null,
  navigate: (view) => set({ view, selectedProjectId: null }),
  openProject: (projectId) => set({ view: 'project-detail', selectedProjectId: projectId }),
  backToProjects: () => set({ view: 'projects', selectedProjectId: null }),

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
  setTimelineZoom: (zoom) => {
    const filters = { zoom, search: get().timelineSearch, poolFilter: get().timelinePoolFilter };
    saveTimelineFilters(filters);
    set({ timelineZoom: zoom });
  },
  setTimelineSearch: (search) => {
    const filters = { zoom: get().timelineZoom, search, poolFilter: get().timelinePoolFilter };
    saveTimelineFilters(filters);
    set({ timelineSearch: search });
  },
  setTimelinePoolFilter: (poolFilter) => {
    const filters = { zoom: get().timelineZoom, search: get().timelineSearch, poolFilter };
    saveTimelineFilters(filters);
    set({ timelinePoolFilter: poolFilter });
  },

  globalFilter: initialGlobalFilterPrefs.filter,
  horizonMonths: initialGlobalFilterPrefs.horizonMonths,
  setGlobalFilter: (filter) => {
    saveGlobalFilterPrefs({ filter, horizonMonths: get().horizonMonths });
    set({ globalFilter: filter });
  },
  setHorizonMonths: (horizonMonths) => {
    saveGlobalFilterPrefs({ filter: get().globalFilter, horizonMonths });
    set({ horizonMonths });
  },

  peopleMode: loadPeopleMode(),
  setPeopleMode: (mode) => {
    localStorage.setItem(PEOPLE_MODE_KEY, mode);
    set({ peopleMode: mode });
  },

  besoinsMode: initialBesoinsPrefs.mode,
  besoinsGranularity: initialBesoinsPrefs.granularity,
  assignationsGranularity: initialBesoinsPrefs.assignationsGranularity,
  setBesoinsMode: (mode) => {
    saveBesoinsPrefs({ mode, granularity: get().besoinsGranularity, assignationsGranularity: get().assignationsGranularity });
    set({ besoinsMode: mode });
  },
  setBesoinsGranularity: (granularity) => {
    saveBesoinsPrefs({ mode: get().besoinsMode, granularity, assignationsGranularity: get().assignationsGranularity });
    set({ besoinsGranularity: granularity });
  },
  setAssignationsGranularity: (granularity) => {
    saveBesoinsPrefs({ mode: get().besoinsMode, granularity: get().besoinsGranularity, assignationsGranularity: granularity });
    set({ assignationsGranularity: granularity });
  },

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
