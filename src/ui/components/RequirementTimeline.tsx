import { useRef, useState } from 'react';
import type { Period } from '../../domain/types';
import { formatPeriodLabel } from '../../domain/periods';
import { Icon } from './Icon';
import { useUiStore } from '../../store/useUiStore';

const MONTH_W = 34;

export interface RequirementLane {
  key: string;
  label: string;
  color: string;
  /** Required/assigned FTE per month, aligned index-for-index with the `months` prop. */
  values: number[];
  onCommitRange: (periods: Period[], fte: number) => void;
  onRemove?: () => void;
}

/** One emploi-repère (specific pool) under a discipline: its currently-assigned people as editable
 * lanes, plus a way to add another of the pool's people. */
export interface AssignmentPoolGroup {
  poolId: string;
  poolName: string;
  color: string;
  personLanes: RequirementLane[];
  addPersonOptions: { id: string; label: string }[];
  onAddPerson: (personId: string) => void;
}

/** One discipline's staffing: an editable need lane, the coverage it gets from people actually
 * assigned (grouped by their specific pool), and a coverage row summarizing the two. */
export interface RequirementGroup {
  key: string;
  label: string;
  color: string;
  needLane: RequirementLane;
  /** Σ assigned FTE per month across every pool group, aligned to `months`. */
  assignedTotals: number[];
  poolGroups: AssignmentPoolGroup[];
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

/** Need-vs-assigned row for a discipline — the gap is colored: under (red), over (amber), matched (neutral). */
function CoverageRow({ label, color, needValues, assignedTotals, months, collapsed, onToggle }: {
  label: string;
  color: string;
  needValues: number[];
  assignedTotals: number[];
  months: Period[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="req-timeline-lane req-timeline-disc-row">
      <div className="req-timeline-lane-label">
        <button type="button" className="req-timeline-collapse" onClick={onToggle} aria-label={collapsed ? 'Expand' : 'Collapse'}>
          <Icon name="chevron-right" size={11} className={collapsed ? '' : 'req-timeline-collapse-open'} />
        </button>
        <span className="discipline-dot" style={{ background: color }} />
        {label}
      </div>
      <div className="req-timeline-lane-track req-timeline-disc-track" style={{ width: months.length * MONTH_W }}>
        {months.map((m, i) => {
          const need = needValues[i] ?? 0;
          const assigned = assignedTotals[i] ?? 0;
          if (need <= 0.001 && assigned <= 0.001) {
            return <div key={m} className="req-timeline-disc-cell" style={{ left: i * MONTH_W, width: MONTH_W }} />;
          }
          const gap = round2(assigned - need);
          const cls = gap < -0.001 ? 'req-coverage-under' : gap > 0.001 ? 'req-coverage-over' : 'req-coverage-ok';
          return (
            <div key={m} className={`req-timeline-disc-cell ${cls}`} style={{ left: i * MONTH_W, width: MONTH_W }}>
              <span>{formatNum(assigned)}/{formatNum(need)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RequirementGroupBlock({ group, months, projectId }: { group: RequirementGroup; months: Period[]; projectId: string }) {
  const collapsed = useUiStore((s) => s.collapsed);
  const toggleCollapse = useUiStore((s) => s.toggleCollapse);
  const discKey = `projtl:disc:${projectId}:${group.key}`;
  const discCollapsed = collapsed[discKey] === true;

  return (
    <div className="req-timeline-group">
      <CoverageRow
        label={group.label}
        color={group.color}
        needValues={group.needLane.values}
        assignedTotals={group.assignedTotals}
        months={months}
        collapsed={discCollapsed}
        onToggle={() => toggleCollapse(discKey)}
      />
      {!discCollapsed && (
        <>
          <RequirementLaneRow lane={group.needLane} months={months} />
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
                {!poolCollapsed && (
                  <>
                    {pg.personLanes.map((lane) => <RequirementLaneRow key={lane.key} lane={lane} months={months} />)}
                    {pg.addPersonOptions.length > 0 && (
                      <div className="req-timeline-add-person">
                        <select
                          className="person-add-select"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) pg.onAddPerson(e.target.value);
                            e.target.value = '';
                          }}
                        >
                          <option value="" disabled>+ Add person…</option>
                          {pg.addPersonOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * Merged need+assignment editor for a project: one group per discipline, each with a coverage row
 * (need vs. assigned, gap highlighted), a draggable discipline-need lane, and — grouped by emploi
 * repère — every assigned person as its own draggable lane. Dragging creates/moves/resizes blocks
 * over month columns; clicking a block edits its FTE. Needs and assignments write through
 * lane.onCommitRange, so this is the single editor for both — there's no separate table anymore.
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

/** Draggable FTE lane: create/move/resize blocks over month columns, click a block to edit its FTE.
 * Exported so PersonDetail can reuse the exact same editable primitive for a person's own timeline. */
export function RequirementLaneRow({ lane, months, membersToggle }: {
  lane: RequirementLane;
  months: Period[];
  /** When set, renders a toggle to show/hide related rows underneath (e.g. assigned members). */
  membersToggle?: { shown: boolean; onToggle: () => void };
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ block: Block; replaceIdx: number } | null>(null);
  const [editingBlock, setEditingBlock] = useState<Block | null>(null);
  const dragRef = useRef<{ mode: DragMode; anchorIdx: number; replaceIdx: number; orig: Block } | null>(null);
  const movedRef = useRef(false);

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
    dragRef.current = { mode: 'create', anchorIdx, replaceIdx: -1, orig };
    setPreview({ block: orig, replaceIdx: -1 });
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function beginBlockDrag(mode: DragMode, block: Block, e: React.PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    movedRef.current = false;
    const replaceIdx = baseBlocks.indexOf(block);
    dragRef.current = { mode, anchorIdx: block.startIdx, replaceIdx, orig: block };
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
      next = { startIdx: Math.min(drag.anchorIdx, idx), endIdx: Math.max(drag.anchorIdx, idx), fte: drag.orig.fte };
    } else if (drag.mode === 'move') {
      const deltaIdx = idx - drag.anchorIdx;
      const span = drag.orig.endIdx - drag.orig.startIdx;
      let start = drag.orig.startIdx + deltaIdx;
      start = Math.max(0, Math.min(months.length - 1 - span, start));
      next = { startIdx: start, endIdx: start + span, fte: drag.orig.fte };
    } else if (drag.mode === 'resize-start') {
      const start = Math.max(0, Math.min(drag.orig.endIdx, idx));
      next = { startIdx: start, endIdx: drag.orig.endIdx, fte: drag.orig.fte };
    } else {
      const end = Math.min(months.length - 1, Math.max(drag.orig.startIdx, idx));
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

  return (
    <div className="req-timeline-lane">
      <div className="req-timeline-lane-label">
        {membersToggle && (
          <button
            type="button"
            className="req-timeline-collapse"
            onClick={membersToggle.onToggle}
            aria-label={membersToggle.shown ? 'Hide people' : 'Show people'}
          >
            <Icon name="chevron-right" size={10} className={membersToggle.shown ? 'req-timeline-collapse-open' : ''} />
          </button>
        )}
        <span className="pool-dot" style={{ background: lane.color }} />
        {lane.label}
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
      </div>
      {editingBlock && (
        <div className="req-block-editor">
          <span>FTE for {formatPeriodLabel(months[editingBlock.startIdx], { withYear: true })}{editingBlock.endIdx !== editingBlock.startIdx ? ` – ${formatPeriodLabel(months[editingBlock.endIdx], { withYear: true })}` : ''}</span>
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
          <button type="button" className="req-block-editor-close" onClick={() => setEditingBlock(null)}>
            <Icon name="close" size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
