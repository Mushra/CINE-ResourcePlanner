import { useRef, useState } from 'react';
import type { Project } from '../../domain/types';
import { isoAddDays, isoDiffDays, xForIsoDate } from './timelineMath';
import type { Period } from '../../domain/types';

type DragMode = 'move' | 'resize-start' | 'resize-end';

export function ProjectBar({
  project, window, pxPerDay, onDatesChange, onClick,
}: {
  project: Project;
  window: Period[];
  pxPerDay: number;
  onDatesChange: (startDate: string, endDate: string) => void;
  onClick: () => void;
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
    </div>
  );
}
