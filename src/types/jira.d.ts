// Ambient type for window.jira, exposed by electron/preload.cjs via contextBridge. Only present
// inside the packaged/dev Electron app — absent in a plain browser tab (see files.ts's
// supportsFileSystemAccess for the analogous pattern).

import type { JiraRawSearchResponse } from '../import/jiraSync';

export type JiraTokenResult = { ok: true } | { ok: false; error: string };
export type JiraSearchResult = { ok: true; raw: JiraRawSearchResponse & { total: number } } | { ok: false; error: string };

export interface JiraSearchArgs {
  projectId: string;
  baseUrl: string;
  authMode: 'cloud' | 'server';
  email: string | null;
  jql: string;
  fields: string[];
  /** Fetches a single maxResults=1 page instead of the full paginated result — used by the
   * Settings screen's "Test connection" probe to confirm auth/JQL without pulling everything. */
  testOnly?: boolean;
}

declare global {
  interface Window {
    jira?: {
      hasToken: (projectId: string) => Promise<boolean>;
      setToken: (projectId: string, pat: string) => Promise<JiraTokenResult>;
      clearToken: (projectId: string) => Promise<JiraTokenResult>;
      search: (args: JiraSearchArgs) => Promise<JiraSearchResult>;
    };
  }
}
