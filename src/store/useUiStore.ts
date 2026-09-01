import { create } from 'zustand';

export type ViewName = 'dashboard' | 'timeline' | 'projects' | 'capacity' | 'forecast' | 'project-detail';

interface UiState {
  view: ViewName;
  selectedProjectId: string | null;
  navigate: (view: ViewName) => void;
  openProject: (projectId: string) => void;
  backToProjects: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: 'dashboard',
  selectedProjectId: null,
  navigate: (view) => set({ view, selectedProjectId: null }),
  openProject: (projectId) => set({ view: 'project-detail', selectedProjectId: projectId }),
  backToProjects: () => set({ view: 'projects', selectedProjectId: null }),
}));
