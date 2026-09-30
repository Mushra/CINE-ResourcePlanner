import { useState } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';

/** A discovered Jira LOQ absent from the plan — the render shape shared by the per-Cinematic banner
 * (no cinematic fields) and the project-wide Sync-drawer panel (cinematicId/name set per row). */
export interface MissingLoqRow {
  jiraKey: string;
  /** Detected department key (a discovery keyword-map key, e.g. "anim") — the bind target. */
  disciplineKey: string;
  /** Resolved plan-discipline name, or null when the department maps to no existing discipline. */
  disciplineName: string | null;
  /** Resolved plan-discipline id, or null when unresolved (row is bind-first, not yet addable). */
  disciplineId: string | null;
  level: string | null;
  summary: string;
  /** Jira assignee display name, when set — used to *pre-fill* the bind picker for an unresolved
   * department (never to bind automatically); see suggestDisciplineForAssignee. */
  assignee?: string | null;
  cinematicId?: string;
  cinematicName?: string;
}

/** Deep-link to a single issue's page. */
function jiraBrowseUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/browse/${key}`;
}

interface DisciplineGroup {
  disciplineKey: string;
  disciplineName: string | null;
  disciplineId: string | null;
  rows: MissingLoqRow[];
}

/** Groups a pre-sorted row list into contiguous department groups (rows arrive sorted by
 * disciplineKey, so a same-key run is always adjacent). */
function toDisciplineGroups(rows: MissingLoqRow[]): DisciplineGroup[] {
  const groups: DisciplineGroup[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.disciplineKey === r.disciplineKey) last.rows.push(r);
    else groups.push({ disciplineKey: r.disciplineKey, disciplineName: r.disciplineName, disciplineId: r.disciplineId, rows: [r] });
  }
  return groups;
}

function rowKey(row: MissingLoqRow, fallbackCinematicId: string | undefined): string {
  return `${row.cinematicId ?? fallbackCinematicId ?? ''}::${row.jiraKey}`;
}

export interface MissingLoqsProps {
  rows: MissingLoqRow[];
  disciplines: { id: string; name: string }[];
  jiraBaseUrl: string | null;
  /** Binds a detected department key onto an existing discipline (remembered globally). The caller
   * re-runs discovery afterwards so the rows resolve and become addable. */
  onBind: (detectedKey: string, disciplineId: string) => void;
  /** Optional: infers the discipline to pre-select in an unresolved group's bind picker from the
   * group's rows (their Jira assignees), so the user usually confirms rather than hunts. Returns a
   * disciplineId present in `disciplines`, or null for no suggestion. The user can always override. */
  suggestDisciplineId?: (rows: MissingLoqRow[]) => string | null;
  onAdd: (selections: { cinematicId: string; jiraKey: string; disciplineId: string; type: string }[]) => void | Promise<void>;
  /** Project mode: rows carry their own cinematicId/name and are grouped under a Cinematic sub-head. */
  groupByCinematic?: boolean;
  /** Banner mode: the single Cinematic every row belongs to (stamped onto add selections). */
  cinematicId?: string;
  /** Header hint line; defaults to the per-Cinematic banner copy. */
  subtitle?: string;
}

/**
 * The "Bind to…" picker shown for an unresolved department. Pre-selects `suggestedDisciplineId` (the
 * assignee-inferred guess) so the common case is a one-click confirm, but keeps its own selection so
 * the user can override before pressing Bind — binding on an explicit click, not on change, is what
 * lets a correct pre-fill be accepted as-is (a change event never fires for the value already shown).
 */
function BindControl({
  disciplines, suggestedDisciplineId, onBind,
}: {
  disciplines: { id: string; name: string }[];
  suggestedDisciplineId: string | null;
  onBind: (disciplineId: string) => void;
}): React.ReactNode {
  // Honour the suggestion only if it names a discipline we actually offer.
  const initial = suggestedDisciplineId && disciplines.some((d) => d.id === suggestedDisciplineId) ? suggestedDisciplineId : '';
  const [value, setValue] = useState(initial);
  return (
    <label className="missing-loq-bind">
      Bind to
      <select value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">existing discipline…</option>
        {disciplines.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
      <Button variant="secondary" size="sm" disabled={!value} onClick={() => { if (value) onBind(value); }}>
        Bind
      </Button>
    </label>
  );
}

/**
 * Discovery surface shared by CinematicDetail's banner and the Sync-with-Jira drawer's project-wide
 * step. Owns its own tick selection (reset whenever the row set changes). Each department group whose
 * discipline is unresolved (disciplineId null) shows a "Bind to…" discipline picker instead of the
 * checkboxes; picking one calls onBind and the caller's re-discovery flips the group to addable.
 */
export function MissingLoqs({
  rows, disciplines, jiraBaseUrl, onBind, suggestDisciplineId, onAdd, groupByCinematic = false, cinematicId, subtitle,
}: MissingLoqsProps) {
  // Ticks are keyed by a stable rowKey; selectedRows below filters to currently-present rows, so a
  // row that drops off after an add/bind simply stops counting (no reset effect needed), and ticks on
  // still-present rows survive a re-discovery.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  if (rows.length === 0) return null;

  function toggle(key: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedRows = rows.filter((r) => r.disciplineId && selected.has(rowKey(r, cinematicId)));

  async function handleAdd(): Promise<void> {
    const selections = selectedRows.map((r) => ({
      cinematicId: r.cinematicId ?? cinematicId ?? '',
      jiraKey: r.jiraKey,
      disciplineId: r.disciplineId as string,
      type: r.level ?? 'L1',
    })).filter((s) => s.cinematicId);
    if (selections.length === 0) return;
    await onAdd(selections);
    setSelected(new Set());
  }

  function renderGroup(g: DisciplineGroup): React.ReactNode {
    return (
      <div key={g.disciplineKey} className="missing-loq-group">
        <div className="missing-loq-group-head">
          {g.disciplineName ?? g.disciplineKey}
          {!g.disciplineId && (
            <BindControl
              disciplines={disciplines}
              suggestedDisciplineId={suggestDisciplineId?.(g.rows) ?? null}
              onBind={(id) => onBind(g.disciplineKey, id)}
            />
          )}
        </div>
        {g.rows.map((m) => {
          const key = rowKey(m, cinematicId);
          return (
            <label key={key} className={`missing-loq-row${g.disciplineId ? '' : ' is-disabled'}`}>
              <input
                type="checkbox"
                disabled={!g.disciplineId}
                checked={selected.has(key)}
                onChange={() => toggle(key)}
              />
              <span className="missing-loq-level">{m.level ?? '—'}</span>
              {jiraBaseUrl
                ? <a className="jira-link" href={jiraBrowseUrl(jiraBaseUrl, m.jiraKey)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{m.jiraKey}</a>
                : <span className="missing-loq-key">{m.jiraKey}</span>}
              <span className="missing-loq-summary">{m.summary}</span>
            </label>
          );
        })}
      </div>
    );
  }

  let body: React.ReactNode;
  if (groupByCinematic) {
    // Rows are pre-sorted by cinematicName, so a same-cinematic run is contiguous.
    const cinematicGroups: { id: string; name: string; rows: MissingLoqRow[] }[] = [];
    for (const r of rows) {
      const last = cinematicGroups[cinematicGroups.length - 1];
      if (last && last.id === (r.cinematicId ?? '')) last.rows.push(r);
      else cinematicGroups.push({ id: r.cinematicId ?? '', name: r.cinematicName ?? '—', rows: [r] });
    }
    body = cinematicGroups.map((cg) => (
      <div key={cg.id} className="missing-loq-cinematic">
        <div className="missing-loq-cinematic-head">{cg.name}</div>
        <div className="missing-loq-groups">{toDisciplineGroups(cg.rows).map(renderGroup)}</div>
      </div>
    ));
  } else {
    body = <div className="missing-loq-groups">{toDisciplineGroups(rows).map(renderGroup)}</div>;
  }

  return (
    <div className="missing-loq-banner">
      <div className="missing-loq-head">
        <Icon name="warning" size={14} />
        <strong>{rows.length} LOQ{rows.length === 1 ? '' : 's'} in Jira not in this plan.</strong>{' '}
        <span className="missing-loq-sub">
          {subtitle ?? 'Linked to this cinematic in Jira, in a tracked department, with no matching LOQ here. Tick the ones to add, or bind an unresolved department to a discipline.'}
        </span>
      </div>
      {body}
      <div className="missing-loq-actions">
        <Button variant="primary" size="sm" icon="plus" disabled={selectedRows.length === 0} onClick={() => void handleAdd()}>
          Add {selectedRows.length} selected LOQ{selectedRows.length === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}
