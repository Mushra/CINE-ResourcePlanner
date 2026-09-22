// Parses a Jira REST `/search` response (POST /rest/api/2/search or v3 equivalent) into
// plan-shaped data. Pure — no DB, no UI, no network. Mirrors mppImport.ts's shape (a Normalized*
// DTO feeding a separate suggest/apply step) and keeps every bit of Jira vocabulary — custom field
// ids, raw status strings, the REST envelope shape — contained here; nothing downstream (domain
// matching, the apply step, the UI) ever sees a raw Jira field name. See docs/INTEGRATIONS.md §3:
// the exact custom field carrying a "start date" is instance-specific and unconfirmed until the
// Phase 5b discovery spike, hence `JiraFieldMapping` rather than a hardcoded field id.

export interface JiraFieldMapping {
  /** Custom field id carrying the issue's start date, e.g. "customfield_10015". Null = unknown/unavailable. */
  startDateField: string | null;
  /** Custom field id carrying the issue's due date. Null = fall back to Jira's native "duedate". */
  dueDateField: string | null;
  /** Custom field id holding the Cinematic-name picklist (Ubisoft-wide global field, confirmed as
   * "customfield_10420" on both discovery-spike projects) — strongest binding signal, see
   * jiraBinding.ts's cascade. Null = not available on this instance. */
  cinematicsListField: string | null;
  /** Custom field id holding the LOQ-level picklist (e.g. "customfield_12338"), confirming the
   * name-parsed LOQ type. Null = not available. */
  loqTargetField: string | null;
  /** Custom field id for a real Epic Link / parent-issue relationship, when the Jira project has
   * one (confirmed present on some projects — e.g. NEO — absent on others — e.g. OVR, where
   * fields.parent is always null). Null = not available; the cascade falls through to name matching. */
  epicLinkField: string | null;
  /** Optional department/ownership scope custom field id (e.g. "CIN level" = "customfield_57706" —
   * a scope filter, not a maturity indicator: distinguishes issues owned by the user's department
   * from another department's, never a signal for date/status quality). Null = no scope filtering. */
  scopeField: string | null;
}

export interface NormalizedJiraIssue {
  key: string;
  summary: string;
  issueType: string;
  /** Raw Jira status string, unmapped — see docs/INTEGRATIONS.md §3.3 for how this compares to LOQ.status. */
  status: string;
  assignee: string | null;
  /** ISO date (yyyy-mm-dd), or null when the field is absent/unmapped. */
  startDate: string | null;
  dueDate: string | null;
  resolutionDate: string | null;
  /** Epic/parent issue key, or null for a top-level issue. Populated from fields.parent — kept
   * separate from epicLinkKey (a dedicated Epic Link/Parent Issue custom field) since a project may
   * have either, both, or neither. */
  parentKey: string | null;
  /** Value of the Cinematics List picklist (mapping.cinematicsListField) — the exact Cinematic name
   * this issue was tagged against, when present. Null = field absent on this issue/project. */
  cinematicName: string | null;
  /** Value of the LOQ Target picklist (mapping.loqTargetField), e.g. "L1"/"L2". Null = absent. */
  loqTarget: string | null;
  /** Value of the configured scope field (mapping.scopeField), e.g. "CIN 1"/"CIN 2". Null = absent
   * or unconfigured — never filtered here, see jiraBinding.ts's scope filter. */
  scopeValue: string | null;
  /** Key from a dedicated Epic Link / Parent Issue custom field (mapping.epicLinkField), distinct
   * from parentKey's native fields.parent. Null = field absent/unconfigured. */
  epicLinkKey: string | null;
  updatedAt: string | null;
}

export interface NormalizedJiraBatch {
  issues: NormalizedJiraIssue[];
  warnings: string[];
}

// Minimal shape of what we read from a Jira REST issue — deliberately loose (raw JSON, custom
// field access by string key) since the exact schema is instance-specific and partially unknown
// until the discovery spike confirms it against a real project.
interface JiraRawIssue {
  key?: string;
  fields?: {
    summary?: string;
    issuetype?: { name?: string } | null;
    status?: { name?: string } | null;
    assignee?: { displayName?: string } | null;
    duedate?: string | null;
    resolutiondate?: string | null;
    parent?: { key?: string } | null;
    updated?: string | null;
    [customField: string]: unknown;
  };
}

export interface JiraRawSearchResponse {
  issues?: JiraRawIssue[];
}

/** Fills in the sensible, confirmed-by-discovery-spike defaults (see docs/INTEGRATIONS.md §3) for
 * whichever mapping fields aren't explicitly configured — e.g. from a per-Project
 * `JiraProjectConfig` that hasn't set every field, or (until the Phase 5b settings screen exists)
 * no config at all. `startDateField`/`dueDateField`/`epicLinkField`/`scopeField` default to
 * "unknown" (null) since they're genuinely instance-variable; `cinematicsListField`/
 * `loqTargetField` default to the two custom field ids confirmed identical across every
 * discovery-spike project (OVR, NEO) — a Ubisoft-wide global field, not a per-project guess. */
export function defaultJiraFieldMapping(overrides: Partial<JiraFieldMapping> = {}): JiraFieldMapping {
  return {
    startDateField: overrides.startDateField ?? null,
    dueDateField: overrides.dueDateField ?? null,
    cinematicsListField: overrides.cinematicsListField ?? 'customfield_10420',
    loqTargetField: overrides.loqTargetField ?? 'customfield_12338',
    epicLinkField: overrides.epicLinkField ?? null,
    scopeField: overrides.scopeField ?? null,
  };
}

export function parseJiraSearchResponse(raw: JiraRawSearchResponse, mapping: JiraFieldMapping): NormalizedJiraBatch {
  const warnings: string[] = [];
  const issues: NormalizedJiraIssue[] = [];

  for (const rawIssue of raw.issues ?? []) {
    if (!rawIssue.key) {
      warnings.push('Skipped a Jira issue with no key in the search response.');
      continue;
    }
    const fields = rawIssue.fields ?? {};
    const dueDateRaw = mapping.dueDateField ? fields[mapping.dueDateField] : fields.duedate;
    const startDateRaw = mapping.startDateField ? fields[mapping.startDateField] : undefined;

    issues.push({
      key: rawIssue.key,
      summary: typeof fields.summary === 'string' ? fields.summary : '',
      issueType: fields.issuetype?.name ?? 'Unknown',
      status: fields.status?.name ?? 'Unknown',
      assignee: fields.assignee?.displayName ?? null,
      startDate: toIsoDate(startDateRaw),
      dueDate: toIsoDate(dueDateRaw ?? fields.duedate),
      resolutionDate: toIsoDate(fields.resolutiondate),
      parentKey: fields.parent?.key ?? null,
      cinematicName: mapping.cinematicsListField ? readOptionValue(fields[mapping.cinematicsListField]) : null,
      loqTarget: mapping.loqTargetField ? readOptionValue(fields[mapping.loqTargetField]) : null,
      scopeValue: mapping.scopeField ? readOptionValue(fields[mapping.scopeField]) : null,
      epicLinkKey: mapping.epicLinkField ? readOptionValue(fields[mapping.epicLinkField]) : null,
      updatedAt: typeof fields.updated === 'string' ? fields.updated : null,
    });
  }

  return { issues, warnings };
}

/** Jira dates come as either a bare "yyyy-mm-dd" (duedate, most date-only custom fields) or a full
 * ISO-8601 datetime with a timezone offset (resolutiondate, updated). The domain only ever stores
 * the date part (see committed_start/committed_finish), so this always collapses to that. */
function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  return value.slice(0, 10);
}

/** Defensive reader for a Jira picklist/select custom field: Server/DC returns `{ value: "..." }`
 * (occasionally `{ name: "..." }` for some field types); a plain string passes through unchanged.
 * Anything else (absent field, unexpected shape) reads as null rather than throwing — every one of
 * these fields is confirmed to vary in availability across projects/issue types (see
 * docs/INTEGRATIONS.md §3), so a missing field is an expected case, not a parse error. */
function readOptionValue(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as { value?: unknown; name?: unknown; key?: unknown };
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.key === 'string') return obj.key;
  }
  return null;
}
