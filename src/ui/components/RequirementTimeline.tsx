import { useRef, useState } from 'react';
import type { Period } from '../../domain/types';
import { formatPeriodLabel, isoFirstDayOfPeriod, isoLastDayOfPeriod, monthsBetween, periodFromISODate } from '../../domain/periods';
import { Icon } from './Icon';
import { useUiStore } from '../../store/useUiStore';

const MONTH_W = 34;

/** One day-precise interval row backing a lane — the same shape as RequirementAllocation /
 * PersonAssignmentAllocation in types.ts, but kept generic here since a lane doesn't care which. */
export interface IntervalRow {
  id: string;
  startDate: string;
  finishDate: string;
  fte: number;
}

export interface RequirementLane {
  key: string;
  label: string;
  color: string;
  /** Required/assigned FTE per month, aligned index-for-index with the `months` prop — drives the
   * month-grid display (blocks, drag create/move/resize) unchanged from Phase 1. */
  values: number[];
  onCommitRange: (periods: Period[], fte: number) => void;
  onRemove?: () => void;
  /** When set, the label renders as a clickable link instead of plain text (e.g. PersonDetail
   * linking each of its assignment lanes to that project). */
  onLabelClick?: () => void;
  /**
   * Day-precise editing (Phase 2): the raw interval rows backing this lane — not the month-
   * aggregated `values` above. When provided, clicking a block opens an interval-list editor
   * (real start/finish dates, not snapped to month boundaries) instead of the plain month-range
   * FTE editor. Optional so a lane can still opt out and keep the old month-only editor.
   */
  intervals?: IntervalRow[];
  onAddInterval?: (startDate: string, finishDate: string, fte: number) => void;
  onUpdateInterval?: (id: string, startDate: string, finishDate: string, fte: number) => void;
  onDeleteInterval?: (id: string) => void;
}

/** One emploi-repère (specific pool) under a discipline: its currently-assigned people as editable
 * lanes. Only pools with at least one assigned person show up — adding the first one to an empty
 * pool happens via the discipline's own "+ Add person" control below, not a per-pool one. */
export interface AssignmentPoolGroup {
  poolId: string;
  poolName: string;
  color: string;
  personLanes: RequirementLane[];
}

/** One discipline's staffing: an editable need lane (its cells hatch-highlight any month where
 * assigned FTE doesn't match), the people actually assigned grouped by their specific pool, and a
 * single "+ Add person" control (any of the discipline's people, landing in their own pool). */
export interface RequirementGroup {
  key: string;
  label: string;
  color: string;
  needLane: RequirementLane;
  /** Σ assigned FTE per month across every pool group, aligned to `months`. */
  assignedTotals: number[];
  poolGroups: AssignmentPoolGroup[];
  addPersonOptions: { id: string; label: string }[];
  onAddPerson: (personId: string) => void;
}

interface Block {
  startIdx: number;
  endIdx: number;
  fte: number;
}

function computeBlocks(values: number[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < values.length) {
    const v = values[i];
    if (Math.abs(v) < 0.001) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < values.length && Math.abs(values[j + 1] - v) < 0.001) j += 1;
    blocks.push({ startIdx: i, endIdx: j, fte: v });
    i = j + 1;
  }
  return blocks;
}

function formatNum(n: number): string {
  return Math.abs(n - Math.round(n)) < 0.001 ? String(Math.round(n)) : n.toFixed(1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function RequirementGroupBlock({ group, months, projectId }: { group: RequirementGroup; months: Period[]; projectId: string }) {
  const collapsed = useUiStore((s) => s.collapsed);
  const toggleCollapse = useUiStore((s) => s.toggleCollapse);
  const setCollapsed = useUiStore((s) => s.setCollapsed);
  const discKey = `projtl:disc:${projectId}:${group.key}`;
  // Discipline rows default to collapsed on first view (unlike other collapsible rows, which
  // default open) — undefined means "never touched", not "explicitly expanded".
  const discCollapsed = collapsed[discKey] ?? true;

  return (
    <div className="req-timeline-group">
      <RequirementLaneRow
        lane={group.needLane}
        months={months}
        assignedValues={group.assignedTotals}
        collapseToggle={{ collapsed: discCollapsed, onToggle: () => setCollapsed(discKey, !discCollapsed) }}
      />
      {!discCollapsed && (
        <>
          {group.poolGroups.map((pg) => {
            const poolKey = `projtl:pool:${projectId}:${pg.poolId}`;
            const poolCollapsed = collapsed[poolKey] === true;
            return (
              <div key={pg.poolId} className="req-timeline-pool-block">
                <div className="req-timeline-pool-subheader">
                  <button
                    type="button"
                    className="req-timeline-collapse"
                    onClick={() => toggleCollapse(poolKey)}
                    aria-label={poolCollapsed ? 'Expand' : 'Collapse'}
                  >
                    <Icon name="chevron-right" size={10} className={poolCollapsed ? '' : 'req-timeline-collapse-open'} />
                  </button>
                  <span className="pool-dot" style={{ background: pg.color }} />
                  {pg.poolName}
                </div>
                {!poolCollapsed && pg.personLanes.map((lane) => <RequirementLaneRow key={lane.key} lane={lane} months={months} />)}
              </div>
            );
          })}
          {group.addPersonOptions.length > 0 && (
            <div className="req-timeline-add-person">
              <select
                className="person-add-select"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) group.onAddPerson(e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="" disabled>+ Add person…</option>
                {group.addPersonOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Merged need+assignment editor for a project: one draggable lane per discipline need (hatched
 * where assigned FTE doesn't match it, that month), and — grouped by emploi repère — every
 * assigned person as its own draggable lane. Dragging creates/moves/resizes blocks over month
 * columns; clicking a block edits its FTE. Needs and assignments write through lane.onCommitRange,
 * so this is the single editor for both — there's no separate table or coverage row anymore.
 */
export function RequirementTimeline({ months, groups, projectId }: {
  months: Period[];
  groups: RequirementGroup[];
  projectId: string;
}) {
  return (
    <div className="req-timeline">
      <p className="req-timeline-hint">
        <Icon name="info" size={12} />
        Drag across a lane to create a block, drag a block to move it, drag its edges to resize, click a block to edit its FTE.
      </p>
      <div className="req-timeline-header" style={{ gridTemplateColumns: `160px repeat(${months.length}, ${MONTH_W}px)` }}>
        <div className="req-timeline-corner" />
        {months.map((m) => <div key={m} className="req-timeline-month">{formatPeriodLabel(m, { withYear: false })}</div>)}
      </div>
      <div className="req-timeline-lanes">
        {groups.map((group) => <RequirementGroupBlock key={group.key} group={group} months={months} projectId={projectId} />)}
      </div>
    </div>
  );
}

type DragMode = 'create' | 'move' | 'resize-start' | 'resize-end';

/** The [min, max] index the drag may not cross — the nearest other block's edge on each side, so a
 * create/move/resize can never overlap an existing block: it stops at the wall instead of
 * overwriting it. */
function dragWalls(others: Block[], fromIdx: number, toIdx: number, monthCount: number): { min: number; max: number } {
  let min = 0;
  let max = monthCount - 1;
  for (const b of others) {
    if (b.endIdx < fromIdx) min = Math.max(min, b.endIdx + 1);
    if (b.startIdx > toIdx) max = Math.min(max, b.startIdx - 1);
  }
  return { min, max };
}

/** Best-effort: some browsers only auto-open the native calendar when the click lands on the
 * icon rather than anywhere in the field. Forcing it on every click (the input itself is what
 * received the click, so activation is always valid here) makes it consistent; failures are
 * silently ignored since the input's own default click behavior already covers most cases. */
function forceShowPicker(e: React.MouseEvent<HTMLInputElement>): void {
  try {
    e.currentTarget.showPicker();
  } catch {
    // ignore — default click behavior on the input already opens it in most browsers
  }
}

/** Draggable FTE lane: create/move/resize blocks over month columns, click a block to edit its FTE.
 * Exported so PersonDetail can reuse the exact same editable primitive for a person's own timeline. */
export function RequirementLaneRow({ lane, months, assignedValues, collapseToggle }: {
  lane: RequirementLane;
  months: Period[];
  /** Actual assigned FTE per month, aligned to `months`. When given (the discipline need lane),
   * any month where it doesn't match `lane.values` is hatch-highlighted, red under / amber over. */
  assignedValues?: number[];
  /** When set, renders a toggle to show/hide rows underneath (e.g. a discipline's pool groups). */
  collapseToggle?: { collapsed: boolean; onToggle: () => void };
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ block: Block; replaceIdx: number } | null>(null);
  const [editingBlock, setEditingBlock] = useState<Block | null>(null);
  const dragRef = useRef<{ mode: DragMode; anchorIdx: number; replaceIdx: number; orig: Block; wallMin: number; wallMax: number } | null>(null);
  const movedRef = useRef(false);
  const startDateInputRef = useRef<HTMLInputElement>(null);
  const endDateInputRef = useRef<HTMLInputElement>(null);

  const baseBlocks = computeBlocks(lane.values);
  const blocks = preview
    ? baseBlocks.filter((_, i) => i !== preview.replaceIdx).concat(preview.block)
    : baseBlocks;

  function idxFromClientX(clientX: number): number {
    const rect = rowRef.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(months.length - 1, Math.floor(x / MONTH_W)));
  }

  function beginCreate(anchorIdx: number, e: React.PointerEvent): void {
    e.preventDefault();
    movedRef.current = false;
    const orig: Block = { startIdx: anchorIdx, endIdx: anchorIdx, fte: 1 };
    const { min, max } = dragWalls(baseBlocks, anchorIdx, anchorIdx, months.length);
    dragRef.current = { mode: 'create', anchorIdx, replaceIdx: -1, orig, wallMin: min, wallMax: max };
    setPreview({ block: orig, replaceIdx: -1 });
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function beginBlockDrag(mode: DragMode, block: Block, e: React.PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    movedRef.current = false;
    const replaceIdx = baseBlocks.indexOf(block);
    // For a move, anchor on the cell actually under the pointer (not the block's left edge) so the
    // block tracks the cursor from wherever it was grabbed instead of snapping to align its edge
    // with the pointer on the very first move.
    const anchorIdx = mode === 'move' ? idxFromClientX(e.clientX) : block.startIdx;
    const others = baseBlocks.filter((_, i) => i !== replaceIdx);
    const { min, max } = dragWalls(others, block.startIdx, block.endIdx, months.length);
    dragRef.current = { mode, anchorIdx, replaceIdx, orig: block, wallMin: min, wallMax: max };
    setPreview({ block, replaceIdx });
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent): void {
    const drag = dragRef.current;
    if (!drag) return;
    const idx = idxFromClientX(e.clientX);
    movedRef.current = true;
    let next: Block;
    if (drag.mode === 'create') {
      const clamped = Math.max(drag.wallMin, Math.min(drag.wallMax, idx));
      next = { startIdx: Math.min(drag.anchorIdx, clamped), endIdx: Math.max(drag.anchorIdx, clamped), fte: drag.orig.fte };
    } else if (drag.mode === 'move') {
      const deltaIdx = idx - drag.anchorIdx;
      const span = drag.orig.endIdx - drag.orig.startIdx;
      let start = drag.orig.startIdx + deltaIdx;
      start = Math.max(drag.wallMin, Math.min(drag.wallMax - span, start));
      next = { startIdx: start, endIdx: start + span, fte: drag.orig.fte };
    } else if (drag.mode === 'resize-start') {
      const start = Math.max(drag.wallMin, Math.min(drag.orig.endIdx, idx));
      next = { startIdx: start, endIdx: drag.orig.endIdx, fte: drag.orig.fte };
    } else {
      const end = Math.min(drag.wallMax, Math.max(drag.orig.startIdx, idx));
      next = { startIdx: drag.orig.startIdx, endIdx: end, fte: drag.orig.fte };
    }
    setPreview({ block: next, replaceIdx: drag.replaceIdx });
  }

  function endDrag(): void {
    const drag = dragRef.current;
    dragRef.current = null;
    const finalPreview = preview;
    setPreview(null);
    if (!drag || !finalPreview) return;
    const finalBlock = finalPreview.block;

    if (drag.mode === 'create') {
      if (finalBlock.startIdx === finalBlock.endIdx && !movedRef.current) return; // plain click on empty cell — no-op
      lane.onCommitRange(months.slice(finalBlock.startIdx, finalBlock.endIdx + 1), 1);
      return;
    }

    const changed = finalBlock.startIdx !== drag.orig.startIdx || finalBlock.endIdx !== drag.orig.endIdx;
    if (!changed) {
      if (!movedRef.current) setEditingBlock(drag.orig); // plain click on a block — edit its FTE
      return;
    }
    lane.onCommitRange(months.slice(drag.orig.startIdx, drag.orig.endIdx + 1), 0);
    lane.onCommitRange(months.slice(finalBlock.startIdx, finalBlock.endIdx + 1), finalBlock.fte);
  }

  function clampIdx(idx: number): number {
    return Math.max(0, Math.min(months.length - 1, idx));
  }

  /** Re-ranges the block currently open in the FTE editor (e.g. from a date-picker pick), keeping
   * the editor open on the new range. Endpoints are sorted so picking a start past the current end
   * (or vice versa) flips which side is which, like dragging a resize handle past the other one. */
  function commitEditingRange(rawStart: number, rawEnd: number): void {
    if (!editingBlock) return;
    const start = clampIdx(Math.min(rawStart, rawEnd));
    const end = clampIdx(Math.max(rawStart, rawEnd));
    if (start === editingBlock.startIdx && end === editingBlock.endIdx) return;
    lane.onCommitRange(months.slice(editingBlock.startIdx, editingBlock.endIdx + 1), 0);
    lane.onCommitRange(months.slice(start, end + 1), editingBlock.fte);
    setEditingBlock({ startIdx: start, endIdx: end, fte: editingBlock.fte });
  }


  return (
    <div className="req-timeline-lane">
      <div className="req-timeline-lane-label">
        {collapseToggle && (
          <button
            type="button"
            className="req-timeline-collapse"
            onClick={collapseToggle.onToggle}
            aria-label={collapseToggle.collapsed ? 'Expand' : 'Collapse'}
          >
            <Icon name="chevron-right" size={10} className={collapseToggle.collapsed ? '' : 'req-timeline-collapse-open'} />
          </button>
        )}
        <span className="pool-dot" style={{ background: lane.color }} />
        {lane.onLabelClick ? (
          <button type="button" className="req-timeline-lane-link" onClick={lane.onLabelClick}>{lane.label}</button>
        ) : lane.label}
        {lane.onRemove && (
          <button type="button" className="req-timeline-lane-remove" title="Remove" onClick={lane.onRemove}>
            <Icon name="close" size={10} />
          </button>
        )}
      </div>
      <div
        ref={rowRef}
        className="req-timeline-lane-track"
        style={{ width: months.length * MONTH_W }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
      >
        {months.map((_, i) => (
          <div
            key={i}
            className="req-timeline-cell"
            style={{ left: i * MONTH_W, width: MONTH_W }}
            onPointerDown={(e) => beginCreate(i, e)}
          />
        ))}
        {blocks.map((b, i) => (
          <div
            key={`${b.startIdx}-${i}`}
            className={`req-block ${preview?.block === b ? 'req-block-preview' : ''}`}
            style={{ left: b.startIdx * MONTH_W, width: (b.endIdx - b.startIdx + 1) * MONTH_W, background: lane.color }}
            onPointerDown={(e) => beginBlockDrag('move', b, e)}
          >
            <span className="req-block-handle req-block-handle-left" onPointerDown={(e) => beginBlockDrag('resize-start', b, e)} />
            <span className="req-block-fte">{b.fte} FTE</span>
            <span className="req-block-handle req-block-handle-right" onPointerDown={(e) => beginBlockDrag('resize-end', b, e)} />
          </div>
        ))}
        {assignedValues && months.map((_, i) => {
          const need = lane.values[i] ?? 0;
          const assigned = assignedValues[i] ?? 0;
          const gap = round2(assigned - need);
          if (Math.abs(gap) < 0.001) return null;
          return (
            <div key={`gap-${i}`} className={`req-need-gap ${gap < 0 ? 'req-need-gap-under' : 'req-need-gap-over'}`} style={{ left: i * MONTH_W, width: MONTH_W }}>
              <span className="req-need-gap-badge">{formatNum(assigned)}</span>
            </div>
          );
        })}
      </div>
      {editingBlock && lane.intervals && lane.onAddInterval && lane.onUpdateInterval && lane.onDeleteInterval ? (
        <IntervalListEditor
          style={{ left: 168 + editingBlock.startIdx * MONTH_W }}
          windowMin={isoFirstDayOfPeriod(months[0])}
          windowMax={isoLastDayOfPeriod(months[months.length - 1])}
          defaultStart={isoFirstDayOfPeriod(months[editingBlock.startIdx])}
          defaultFinish={isoLastDayOfPeriod(months[editingBlock.endIdx])}
          intervals={lane.intervals.filter(
            (iv) => iv.finishDate >= isoFirstDayOfPeriod(months[editingBlock.startIdx])
              && iv.startDate <= isoLastDayOfPeriod(months[editingBlock.endIdx]),
          )}
          onAdd={lane.onAddInterval}
          onUpdate={lane.onUpdateInterval}
          onDelete={lane.onDeleteInterval}
          onClose={() => setEditingBlock(null)}
        />
      ) : editingBlock && (
        <div className="req-block-editor" style={{ left: 168 + editingBlock.startIdx * MONTH_W }}>
          <span className="req-block-editor-label">FTE for</span>
          <span className="req-block-editor-date-wrap" title={formatPeriodLabel(months[editingBlock.startIdx], { withYear: true })}>
            <input
              ref={startDateInputRef}
              type="date"
              className="req-block-editor-date-input"
              value={isoFirstDayOfPeriod(months[editingBlock.startIdx])}
              min={isoFirstDayOfPeriod(months[0])}
              max={isoLastDayOfPeriod(months[months.length - 1])}
              onClick={forceShowPicker}
              onChange={(e) => {
                const period = periodFromISODate(e.target.value);
                if (period) commitEditingRange(monthsBetween(months[0], period), editingBlock.endIdx);
              }}
            />
          </span>
          {editingBlock.endIdx !== editingBlock.startIdx && (
            <>
              <span className="req-block-editor-sep">–</span>
              <span className="req-block-editor-date-wrap" title={formatPeriodLabel(months[editingBlock.endIdx], { withYear: true })}>
                <input
                  ref={endDateInputRef}
                  type="date"
                  className="req-block-editor-date-input"
                  value={isoLastDayOfPeriod(months[editingBlock.endIdx])}
                  min={isoFirstDayOfPeriod(months[0])}
                  max={isoLastDayOfPeriod(months[months.length - 1])}
                  onClick={forceShowPicker}
                  onChange={(e) => {
                    const period = periodFromISODate(e.target.value);
                    if (period) commitEditingRange(editingBlock.startIdx, monthsBetween(months[0], period));
                  }}
                />
              </span>
            </>
          )}
          <input
            type="number"
            step={0.5}
            min={0}
            autoFocus
            className="num-input"
            defaultValue={editingBlock.fte}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            onBlur={(e) => {
              const fte = parseFloat(e.target.value) || 0;
              lane.onCommitRange(months.slice(editingBlock.startIdx, editingBlock.endIdx + 1), fte);
              setEditingBlock(null);
            }}
          />
          <button
            type="button"
            className="req-block-editor-delete"
            title="Delete"
            onClick={() => {
              lane.onCommitRange(months.slice(editingBlock.startIdx, editingBlock.endIdx + 1), 0);
              setEditingBlock(null);
            }}
          >
            <Icon name="trash" size={11} />
          </button>
          <button type="button" className="req-block-editor-close" onClick={() => setEditingBlock(null)}>
            <Icon name="close" size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

function IntervalListEditor({
  style,
  intervals,
  windowMin,
  windowMax,
  defaultStart,
  defaultFinish,
  onAdd,
  onUpdate,
  onDelete,
  onClose,
}: {
  style: React.CSSProperties;
  intervals: IntervalRow[];
  windowMin: string;
  windowMax: string;
  defaultStart: string;
  defaultFinish: string;
  onAdd: (startDate: string, finishDate: string, fte: number) => void;
  onUpdate: (id: string, startDate: string, finishDate: string, fte: number) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  function updateStart(iv: IntervalRow, newStart: string): void {
    onUpdate(iv.id, newStart, newStart > iv.finishDate ? newStart : iv.finishDate, iv.fte);
  }
  function updateFinish(iv: IntervalRow, newFinish: string): void {
    onUpdate(iv.id, newFinish < iv.startDate ? newFinish : iv.startDate, newFinish, iv.fte);
  }

  return (
    <div className="req-block-editor interval-list-editor" style={style}>
      <div className="interval-list-editor-rows">
        {intervals.length === 0 && <p className="interval-list-editor-empty">No interval yet.</p>}
        {intervals.map((iv) => (
          <div key={iv.id} className="interval-list-editor-row">
            <input
              type="date"
              className="req-block-editor-date-input"
              value={iv.startDate}
              min={windowMin}
              max={windowMax}
              onClick={forceShowPicker}
              onChange={(e) => e.target.value && updateStart(iv, e.target.value)}
            />
            <span className="req-block-editor-sep">–</span>
            <input
              type="date"
              className="req-block-editor-date-input"
              value={iv.finishDate}
              min={windowMin}
              max={windowMax}
              onClick={forceShowPicker}
              onChange={(e) => e.target.value && updateFinish(iv, e.target.value)}
            />
            <input
              type="number"
              step={0.5}
              min={0}
              className="num-input"
              defaultValue={iv.fte}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              onBlur={(e) => onUpdate(iv.id, iv.startDate, iv.finishDate, parseFloat(e.target.value) || 0)}
            />
            <button type="button" className="req-block-editor-delete" title="Delete this interval" onClick={() => onDelete(iv.id)}>
              <Icon name="trash" size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="interval-list-editor-footer">
        <button type="button" className="interval-list-editor-add" onClick={() => onAdd(defaultStart, defaultFinish, 1)}>
          <Icon name="plus" size={10} /> Add interval
        </button>
        <button type="button" className="req-block-editor-close" onClick={onClose}>
          <Icon name="close" size={11} />
        </button>
      </div>
    </div>
  );
}
