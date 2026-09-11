import { useRef, useState } from 'react';
import type { Project } from '../../domain/types';
import { isoAddDays, isoDiffDays, xForIsoDate } from './timelineMath';
import { periodFromISODate } from '../../domain/periods';
import { formatNum } from './AllocationCell';
import type { Period } from '../../domain/types';

type DragMode = 'move' | 'resize-start' | 'resize-end';

/** Portions the bar into contiguous runs of stable assigned FTE, so the total for a stretch of
 * months reads as one block instead of a sparse marker at each change point. */
function assignedSegments(
  window: Period[], pxPerDay: number, barLeft: number, barRight: number, startDate: string, endDate: string, assignedByPeriod: Map<Period, number>,
): { x: number; width: number; fte: number }[] {
  const startPeriod = periodFromISODate(startDate);
  const endPeriod = periodFromISODate(endDate);
  if (!startPeriod || !endPeriod) return [];
  const segments: { x: number; width: number; fte: number }[] = [];
  let run: { x: number; fte: number } | null = null;

  function flush(endX: number) {
    if (run) segments.push({ x: run.x, width: Math.max(0, endX - run.x), fte: run.fte });
    run = null;
  }

  for (const period of window) {
    if (period < startPeriod || period > endPeriod) continue;
    const fte = Math.round((assignedByPeriod.get(period) ?? 0) * 100) / 100;
    const x = Math.max(0, xForIsoDate(`${period}-01`, window, pxPerDay) - barLeft);
    if (!run || run.fte !== fte) {
      flush(x);
      if (fte > 0.001) run = { x, fte };
    }
  }
  flush(barRight - barLeft);
  return segments;
}

export function ProjectBar({
  project, window, pxPerDay, onDatesChange, onClick, assignedByPeriod,
}: {
  project: Project;
  window: Period[];
  pxPerDay: number;
  onDatesChange: (startDate: string, endDate: string) => void;
  onClick: () => void;
  assignedByPeriod: Map<Period, number>;
}) {
  const [preview, setPreview] = useState<{ start: string; end: string } | null>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; origStart: string; origEnd: string } | null>(null);
  const movedRef = useRef(false);

  if (!project.startDate || !project.endDate) return null;
  const start = preview?.start ?? project.startDate;
  const end = preview?.end ?? project.endDate;

  const left = xForIsoDate(start, window, pxPerDay);
  const right = xForIsoDate(isoAddDays(end, 1), window, pxPerDay);
  const width = Math.max(pxPerDay * 3, right - left);
  const segments = preview ? [] : assignedSegments(window, pxPerDay, left, left + width, project.startDate, project.endDate, assignedByPeriod);

  function beginDrag(mode: DragMode, e: React.PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    movedRef.current = false;
    dragRef.current = { mode, startX: e.clientX, origStart: project.startDate!, origEnd: project.endDate! };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent): void {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaPx = e.clientX - drag.startX;
    const deltaDays = Math.round(deltaPx / pxPerDay);
    if (deltaDays === 0) {
      setPreview(null);
      return;
    }
    movedRef.current = true;
    if (drag.mode === 'move') {
      setPreview({ start: isoAddDays(drag.origStart, deltaDays), end: isoAddDays(drag.origEnd, deltaDays) });
    } else if (drag.mode === 'resize-start') {
      const newStart = isoAddDays(drag.origStart, deltaDays);
      if (isoDiffDays(newStart, drag.origEnd) >= 1) setPreview({ start: newStart, end: drag.origEnd });
    } else {
      const newEnd = isoAddDays(drag.origEnd, deltaDays);
      if (isoDiffDays(drag.origStart, newEnd) >= 1) setPreview({ start: drag.origStart, end: newEnd });
    }
  }

  function endDrag(): void {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && preview && (preview.start !== drag.origStart || preview.end !== drag.origEnd)) {
      onDatesChange(preview.start, preview.end);
    }
    setPreview(null);
  }

  const isEstimated = project.startCertainty !== 'confirmed' || project.endCertainty !== 'confirmed';

  return (
    <div
      className={`project-bar priority-bar-${project.priority} ${isEstimated ? 'bar-estimated' : 'bar-confirmed'} ${preview ? 'bar-dragging' : ''}`}
      style={{ left, width }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
    >
      <span className="bar-handle bar-handle-left" onPointerDown={(e) => beginDrag('resize-start', e)} />
      <button
        type="button"
        className="bar-body"
        onPointerDown={(e) => beginDrag('move', e)}
        onClick={(e) => {
          if (movedRef.current) {
            e.preventDefault();
            movedRef.current = false;
            return;
          }
          onClick();
        }}
      >
        {project.name}
      </button>
      <span className="bar-handle bar-handle-right" onPointerDown={(e) => beginDrag('resize-end', e)} />
      {segments.map((seg) => (
        <span
          key={seg.x}
          className={`bar-seg ${seg.width < 26 ? 'bar-seg-compact' : ''}`}
          style={{ left: seg.x, width: seg.width }}
          title={`${formatNum(seg.fte)} FTE alloué`}
        >
          {seg.width >= 26 && `${formatNum(seg.fte)} FTE`}
        </span>
      ))}
    </div>
  );
}
