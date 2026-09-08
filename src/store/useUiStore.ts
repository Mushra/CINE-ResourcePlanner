import { create } from 'zustand';

export type ViewName = 'dashboard' | 'timeline' | 'projects' | 'team' | 'forecast' | 'project-detail' | 'structure';
export type TimelineZoom = 'compact' | 'comfortable' | 'wide';

const COLLAPSE_STORAGE_KEY = 'cine-planner-collapse';
const TIMELINE_FILTERS_KEY = 'cine-planner-timeline-filters';
const TEAM_FILTERS_KEY = 'cine-planner-team-filters';
const BESOINS_PREFS_KEY = 'cine-planner-besoins-prefs';

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

interface TeamFilters {
  team: string[] | null;
  discipline: string[] | null;
}

function loadTeamFilters(): TeamFilters {
  const fallback: TeamFilters = { team: null, discipline: null };
  try {
    const raw = localStorage.getItem(TEAM_FILTERS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    return {
      team: Array.isArray(parsed.team) ? parsed.team : null,
      discipline: Array.isArray(parsed.discipline) ? parsed.discipline : null,
    };
  } catch {
    return fallback;
  }
}

function saveTeamFilters(filters: TeamFilters): void {
  localStorage.setItem(TEAM_FILTERS_KEY, JSON.stringify(filters));
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

  teamFilter: string[] | null;
  teamDisciplineFilter: string[] | null;
  setTeamFilter: (teamFilter: string[] | null) => void;
  setTeamDisciplineFilter: (disciplineFilter: string[] | null) => void;

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
const initialTeamFilters = loadTeamFilters();
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

  teamFilter: initialTeamFilters.team,
  teamDisciplineFilter: initialTeamFilters.discipline,
  setTeamFilter: (teamFilter) => {
    saveTeamFilters({ team: teamFilter, discipline: get().teamDisciplineFilter });
    set({ teamFilter });
  },
  setTeamDisciplineFilter: (disciplineFilter) => {
    saveTeamFilters({ team: get().teamFilter, discipline: disciplineFilter });
    set({ teamDisciplineFilter: disciplineFilter });
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
