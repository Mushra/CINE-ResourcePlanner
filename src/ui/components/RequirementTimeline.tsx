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
  /** Required FTE per month, aligned index-for-index with the `months` prop. */
  values: number[];
  onCommitRange: (periods: Period[], fte: number) => void;
  onRemove?: () => void;
}

/** One assigned person under a role lane — read-only, mirrors the main Timeline's person rows. */
export interface RequirementGroupMember {
  personId: string;
  name: string;
  /** Assigned FTE per month, aligned index-for-index with the `months` prop. */
  fte: number[];
}

export interface RequirementPoolLane {
  lane: RequirementLane;
  members: RequirementGroupMember[];
}

/** One discipline's requirement lanes, with a read-only total row and each role's assigned members underneath. */
export interface RequirementGroup {
  key: string;
  label: string;
  color: string;
  /** Aggregate required FTE per month across the discipline's lanes, aligned to `months`. */
  totals: number[];
  /** The discipline-wide ("whole discipline") lane, if a generic requirement exists. */
  genericLane?: RequirementLane;
  poolLanes: RequirementPoolLane[];
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

/** Read-only aggregate row for a discipline's total required FTE — styled like the main Timeline's discipline cell. */
function DisciplineTotalRow({ label, color, totals, months, collapsed, onToggle }: {
  label: string;
  color: string;
  totals: number[];
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
        {months.map((m, i) => (
          <div key={m} className="req-timeline-disc-cell" style={{ left: i * MONTH_W, width: MONTH_W }}>
            {totals[i] > 0.001 && <span>{formatNum(totals[i])}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Read-only per-person FTE row under a role lane — mirrors the main Timeline's person rows. */
function MemberRow({ member, months }: { member: RequirementGroupMember; months: Period[] }) {
  return (
    <div className="req-timeline-lane req-timeline-member-row">
      <div className="req-timeline-lane-label req-timeline-member-label">{member.name}</div>
      <div className="req-timeline-lane-track req-timeline-disc-track" style={{ width: months.length * MONTH_W }}>
        {months.map((m, i) => (
          <div key={m} className="req-timeline-disc-cell" style={{ left: i * MONTH_W, width: MONTH_W }}>
            {member.fte[i] > 0.001 && <span>{formatNum(member.fte[i])}</span>}
          </div>
        ))}
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
      <DisciplineTotalRow
        label={group.label}
        color={group.color}
        totals={group.totals}
        months={months}
        collapsed={discCollapsed}
        onToggle={() => toggleCollapse(discKey)}
      />
      {!discCollapsed && (
        <>
          {group.genericLane && <RequirementLaneRow lane={group.genericLane} months={months} />}
          {group.poolLanes.map(({ lane, members }) => {
            const poolKey = `projtl:pool:${projectId}:${lane.key}`;
            const membersShown = collapsed[poolKey] === true;
            return (
              <div key={lane.key} className="req-timeline-pool-block">
                <RequirementLaneRow
                  lane={lane}
                  months={months}
                  membersToggle={members.length > 0 ? { shown: membersShown, onToggle: () => toggleCollapse(poolKey) } : undefined}
                />
                {membersShown && members.map((m) => <MemberRow key={m.personId} member={m} months={months} />)}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * Mini-Gantt for a project's resource requirements: one group per discipline (with a read-only
 * total row), each holding draggable role lanes (create/move/resize blocks by mouse over month
 * columns — writes the same requirement_allocations as the Besoins table via lane.onCommitRange,
 * so edits here and in the table stay in sync) and, underneath each role, its assigned members'
 * read-only FTE.
 */
export function RequirementTimeline({
  months, groups, addOptions, onAddLane, projectId,
}: {
  months: Period[];
  groups: RequirementGroup[];
  addOptions: { id: string; label: string }[];
  onAddLane: (targetId: string) => void;
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
      {addOptions.length > 0 && (
        <div className="req-timeline-add">
          <select
            className="person-add-select"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onAddLane(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>+ Add lane…</option>
            {addOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

type DragMode = 'create' | 'move' | 'resize-start' | 'resize-end';

function RequirementLaneRow({ lane, months, membersToggle }: {
  lane: RequirementLane;
  months: Period[];
  /** When set, renders a toggle to show/hide this role's assigned members underneath. */
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
