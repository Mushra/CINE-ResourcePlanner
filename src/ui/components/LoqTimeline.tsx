import { useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { isoAddDays, isoDiffDays } from '../timeline/timelineMath';
import { loqEffectiveFinish } from '../../engine/loqRollup';
import { Icon } from './Icon';
import type { Loq, LoqResource } from '../../domain/types';

const DAY_W = 28;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function enumerateDays(startIso: string, endIso: string): string[] {
  const days: string[] = [];
  let cursor = startIso;
  let guard = 0;
  while (cursor <= endIso && guard < 2000) {
    days.push(cursor);
    cursor = isoAddDays(cursor, 1);
    guard += 1;
  }
  return days;
}

/** Visible day window: padded around every committed LOQ/resource date, or two weeks around today
 * when nothing is scheduled yet — so a brand-new cinematic still shows a usable grid. */
function computeWindow(loqs: Loq[], resources: LoqResource[]): { days: string[]; startIso: string } {
  const today = todayIso();
  let min = today;
  let max = today;
  for (const loq of loqs) {
    if (!loq.committedStart) continue;
    if (loq.committedStart < min) min = loq.committedStart;
    const finish = loqEffectiveFinish(loq) ?? loq.committedStart;
    if (finish > max) max = finish;
  }
  for (const r of resources) {
    if (r.startDate && r.startDate < min) min = r.startDate;
    if (r.finishDate && r.finishDate > max) max = r.finishDate;
  }
  const startIso = isoAddDays(min, -4);
  const endIso = isoAddDays(max, 10);
  return { days: enumerateDays(startIso, endIso), startIso };
}

function xForDay(iso: string, startIso: string): number {
  return isoDiffDays(startIso, iso) * DAY_W;
}

function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

type DragMode = 'move' | 'resize-start' | 'resize-end';

/** A draggable window bar shared by LOQ rows and resource rows: drag the body to move both dates,
 * drag an edge to resize one side. Commits are always explicit ISO dates — dragging a LOQ's implicit
 * finish turns it into an explicit committedFinish, per the V1 direct-write decision. */
function WindowBar({
  start, finish, startIso, color, label, onCommit, onClick,
}: {
  start: string;
  finish: string;
  startIso: string;
  color: string;
  label: string;
  onCommit: (start: string, finish: string) => void;
  onClick?: () => void;
}) {
  const [preview, setPreview] = useState<{ start: string; finish: string } | null>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; origStart: string; origFinish: string } | null>(null);
  const movedRef = useRef(false);

  const curStart = preview?.start ?? start;
  const curFinish = preview?.finish ?? finish;
  const left = xForDay(curStart, startIso);
  const width = Math.max(DAY_W, (isoDiffDays(curStart, curFinish) + 1) * DAY_W);

  function beginDrag(mode: DragMode, e: React.PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    movedRef.current = false;
    dragRef.current = { mode, startX: e.clientX, origStart: start, origFinish: finish };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent): void {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaDays = Math.round((e.clientX - drag.startX) / DAY_W);
    if (deltaDays === 0) {
      setPreview(null);
      return;
    }
    movedRef.current = true;
    if (drag.mode === 'move') {
      setPreview({ start: isoAddDays(drag.origStart, deltaDays), finish: isoAddDays(drag.origFinish, deltaDays) });
    } else if (drag.mode === 'resize-start') {
      const newStart = isoAddDays(drag.origStart, deltaDays);
      if (isoDiffDays(newStart, drag.origFinish) >= 0) setPreview({ start: newStart, finish: drag.origFinish });
    } else {
      const newFinish = isoAddDays(drag.origFinish, deltaDays);
      if (isoDiffDays(drag.origStart, newFinish) >= 0) setPreview({ start: drag.origStart, finish: newFinish });
    }
  }

  function endDrag(): void {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && preview && (preview.start !== drag.origStart || preview.finish !== drag.origFinish)) {
      onCommit(preview.start, preview.finish);
    }
    setPreview(null);
  }

  return (
    <div
      className={`loq-bar ${preview ? 'loq-bar-dragging' : ''}`}
      style={{ left, width, background: color }}
      title={`${label}: ${curStart} → ${curFinish}`}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
    >
      <span className="loq-bar-handle loq-bar-handle-left" onPointerDown={(e) => beginDrag('resize-start', e)} />
      <button
        type="button"
        className="loq-bar-body"
        onPointerDown={(e) => beginDrag('move', e)}
        onClick={(e) => {
          if (movedRef.current) {
            e.preventDefault();
            movedRef.current = false;
            return;
          }
          onClick?.();
        }}
      >
        {label}
      </button>
      <span className="loq-bar-handle loq-bar-handle-right" onPointerDown={(e) => beginDrag('resize-end', e)} />
    </div>
  );
}

function ResourceRow({ resource, startIso, trackWidth }: { resource: LoqResource; startIso: string; trackWidth: number }) {
  const people = useStore((s) => s.data.people);
  const updateLoqResource = useStore((s) => s.updateLoqResource);
  const deleteLoqResource = useStore((s) => s.deleteLoqResource);
  const [editing, setEditing] = useState(false);
  const person = people.find((p) => p.id === resource.personId);

  return (
    <div className="loq-resource-row">
      <div className="loq-resource-row-main">
        <div className="loq-row-label loq-resource-label">{person?.name ?? 'Unknown person'}</div>
        <div className="loq-row-track" style={{ width: trackWidth }}>
          {resource.startDate && resource.finishDate ? (
            <WindowBar
              start={resource.startDate}
              finish={resource.finishDate}
              startIso={startIso}
              color="var(--text-tertiary)"
              label={`${resource.fte} FTE`}
              onCommit={(start, finish) => updateLoqResource({ ...resource, startDate: start, finishDate: finish })}
              onClick={() => setEditing(true)}
            />
          ) : (
            <button
              type="button"
              className="loq-resource-unscheduled"
              onClick={() => updateLoqResource({ ...resource, startDate: todayIso(), finishDate: todayIso() })}
            >
              Set dates…
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="loq-resource-editor">
          <label>
            Start
            <input
              type="date"
              value={resource.startDate ?? ''}
              onChange={(e) => updateLoqResource({ ...resource, startDate: e.target.value || null })}
            />
          </label>
          <label>
            Finish
            <input
              type="date"
              value={resource.finishDate ?? ''}
              onChange={(e) => updateLoqResource({ ...resource, finishDate: e.target.value || null })}
            />
          </label>
          <label>
            FTE
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              className="num-input"
              defaultValue={resource.fte}
              onBlur={(e) => updateLoqResource({ ...resource, fte: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <button type="button" className="loq-resource-editor-delete" title="Remove" onClick={() => { deleteLoqResource(resource.id); setEditing(false); }}>
            <Icon name="trash" size={12} />
          </button>
          <button type="button" className="loq-resource-editor-close" onClick={() => setEditing(false)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function LoqRow({ loq, startIso, trackWidth, onEditLoq, onRecommit }: {
  loq: Loq;
  startIso: string;
  trackWidth: number;
  onEditLoq: (loq: Loq) => void;
  onRecommit: (loq: Loq, initialStart: string | null, initialFinish: string | null) => void;
}) {
  const disciplines = useStore((s) => s.data.disciplines);
  const people = useStore((s) => s.data.people);
  const loqResources = useStore((s) => s.data.loqResources);
  const createLoqResource = useStore((s) => s.createLoqResource);
  const [expanded, setExpanded] = useState(false);

  const discipline = disciplines.find((d) => d.id === loq.disciplineId);
  const resources = loqResources.filter((r) => r.loqId === loq.id);
  const assignedIds = new Set(resources.map((r) => r.personId));
  const addOptions = people.filter((p) => p.active && !assignedIds.has(p.id));
  const finish = loqEffectiveFinish(loq);

  return (
    <div className="loq-tl-group">
      <div className="loq-row">
        <div className="loq-row-label">
          <button type="button" className="loq-row-collapse" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Collapse' : 'Expand'}>
            <Icon name="chevron-right" size={10} className={expanded ? 'loq-row-collapse-open' : ''} />
          </button>
          <span className="pool-dot" style={{ background: discipline?.color ?? 'var(--text-tertiary)' }} />
          <span className="loq-row-name">{discipline?.name ?? 'Unassigned'} · {loq.type}</span>
        </div>
        <div className="loq-row-track" style={{ width: trackWidth }}>
          {loq.committedStart && finish ? (
            <WindowBar
              start={loq.committedStart}
              finish={finish}
              startIso={startIso}
              color={discipline?.color ?? 'var(--accent)'}
              label={loq.type}
              onCommit={(start, newFinish) => onRecommit(loq, start, newFinish)}
              onClick={() => onEditLoq(loq)}
            />
          ) : (
            <button type="button" className="loq-row-unscheduled" onClick={() => onRecommit(loq, null, null)}>
              Unscheduled — set a start date to place it on the timeline
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="loq-resource-rows">
          {resources.map((r) => <ResourceRow key={r.id} resource={r} startIso={startIso} trackWidth={trackWidth} />)}
          {addOptions.length > 0 && (
            <select
              className="loq-resource-add-select"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                createLoqResource({
                  loqId: loq.id,
                  personId: e.target.value,
                  startDate: loq.committedStart,
                  finishDate: finish,
                  fte: 1,
                });
                e.target.value = '';
              }}
            >
              <option value="" disabled>+ Assign person…</option>
              {addOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Day-level drag editor for a cinematic's LOQs: one bar per LOQ spanning its committed window
 * (falling back to the implicit estimateDays-derived finish), expandable to its LoqResource windows.
 * Dragging a LOQ bar or its edges opens RecommitDialog (via onRecommit) instead of writing straight
 * through — committed dates are an attributed, justified event (PLANNING_ENGINE.md §3). Resource
 * bars are unaffected by that rule and still write straight through updateLoqResource.
 */
export function LoqTimeline({ cinematicId, onEditLoq, onRecommit }: {
  cinematicId: string;
  onEditLoq: (loq: Loq) => void;
  onRecommit: (loq: Loq, initialStart: string | null, initialFinish: string | null) => void;
}) {
  const allLoqs = useStore((s) => s.data.loqs);
  const loqs = allLoqs.filter((l) => l.cinematicId === cinematicId).sort((a, b) => a.sortOrder - b.sortOrder);
  const loqResources = useStore((s) => s.data.loqResources);
  const loqIds = new Set(loqs.map((l) => l.id));
  const relevantResources = loqResources.filter((r) => loqIds.has(r.loqId));
  const { days, startIso } = computeWindow(loqs, relevantResources);
  const trackWidth = days.length * DAY_W;
  const today = todayIso();

  const monthRuns: { label: string; days: number }[] = [];
  for (const day of days) {
    const label = monthLabel(day);
    const run = monthRuns[monthRuns.length - 1];
    if (run && run.label === label) run.days += 1;
    else monthRuns.push({ label, days: 1 });
  }

  return (
    <div className="loq-timeline">
      <p className="loq-timeline-hint">
        <Icon name="info" size={12} />
        Drag a bar to move it, drag its edges to resize. Click a LOQ's bar to edit it; expand a row to assign people.
      </p>
      <div className="loq-timeline-scroll">
        <div className="loq-timeline-header" style={{ width: 200 + trackWidth }}>
          <div className="loq-timeline-corner" />
          <div className="loq-timeline-months" style={{ width: trackWidth }}>
            {monthRuns.map((run, i) => <div key={i} className="loq-timeline-month" style={{ width: run.days * DAY_W }}>{run.label}</div>)}
          </div>
        </div>
        <div className="loq-timeline-header loq-timeline-days" style={{ width: 200 + trackWidth }}>
          <div className="loq-timeline-corner" />
          <div className="loq-timeline-day-cells" style={{ width: trackWidth }}>
            {days.map((d) => (
              <div key={d} className={`loq-day-cell ${isWeekend(d) ? 'loq-day-weekend' : ''} ${d === today ? 'loq-day-today' : ''}`} style={{ width: DAY_W }}>
                {Number(d.slice(8, 10))}
              </div>
            ))}
          </div>
        </div>
        <div className="loq-timeline-rows">
          {loqs.map((loq) => (
            <LoqRow key={loq.id} loq={loq} startIso={startIso} trackWidth={trackWidth} onEditLoq={onEditLoq} onRecommit={onRecommit} />
          ))}
        </div>
      </div>
    </div>
  );
}
