// Ambient type for window.mpp, exposed by electron/preload.cjs via contextBridge. Only present
// inside the packaged/dev Electron app — absent in a plain browser tab (see files.ts's
// supportsFileSystemAccess for the analogous pattern).

export interface MppTaskJson {
  uid: number;
  name: string;
  cinematicName: string | null;
  discipline: string | null;
  loqType: string | null;
  jiraKey: string;
  start: string | null;
  finish: string | null;
  durationDays: number | null;
  workHours: number | null;
  predecessors: { uid: number; type: string; lagDays: number }[];
  resources: { name: string; group: string | null; start: string | null; finish: string | null; units: number }[];
}

export interface MppRosterEntryJson {
  name: string;
  group: string | null;
}

export interface MppShimOutput {
  totalNonSummaryTasks: number;
  tasks: MppTaskJson[];
  resourceRoster: MppRosterEntryJson[];
}

export type MppPickAndParseResult =
  | { canceled: true }
  | { canceled: false; fileName: string; json: MppShimOutput }
  | { canceled: false; error: string };

declare global {
  interface Window {
    mpp?: {
      pickAndParse: () => Promise<MppPickAndParseResult>;
    };
  }
}
