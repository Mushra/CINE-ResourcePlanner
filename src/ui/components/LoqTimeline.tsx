import { useEffect, useRef, useState, type CSSProperties, type WheelEvent } from 'react';
import { useStore } from '../../store/useStore';
import { TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_DEFAULT } from '../../store/useUiStore';
import {
  fineAxisTicks, fitZoomForWidth, isoAddDays, isoDiffDays, isoToDayOfMonth, monthWidthPx, monthWindowForIsoRange,
  pxPerDayForZoom, timelineGranularity, totalWindowWidth, xForIsoDate, zoomAfterWheel,
} from '../timeline/timelineMath';
import { formatPeriodLabel } from '../../domain/periods';
import { TimelineZoomControl } from '../timeline/TimelineZoomControl';
import { loqEffectiveFinish } from '../../engine/loqRollup';
import type { LoqForecast } from '../../engine/loqForecast';
import { Icon } from './Icon';
import { Button } from './Button';
import type { Loq, LoqResource, Period } from '../../domain/types';

/** Width of the sticky left label column (keep in sync with .loq-row-label / .loq-timeline-corner). */
const LABEL_W = 200;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The ISO range the Schedule covers: the span of every committed LOQ/resource date padded two
 * weeks on each side (per the user's "first LOQ −2w … last +2w" request), or two weeks around today
 * when nothing is scheduled yet — so a brand-new cinematic still shows a usable grid. */
function computeDateRange(loqs: Loq[], resources: LoqResource[]): { minIso: string; maxIso: string } {
  const today = todayIso();
  let min: string | null = null;
  let max: string | null = null;
  const extend = (iso: string | null | undefined): void => {
    if (!iso) return;
    if (min === null || iso < min) min = iso;
    if (max === null || iso > max) max = iso;
  };
  for (const loq of loqs) {
    if (!loq.committedStart) continue;
    extend(loq.committedStart);
    extend(loqEffectiveFinish(loq) ?? loq.committedStart);
  }
  for (const r of resources) {
    extend(r.startDate);
    extend(r.finishDate);
  }
  return { minIso: isoAddDays(min ?? today, -14), maxIso: isoAddDays(max ?? today, 14) };
}

type DragMode = 'move' | 'resize-start' | 'resize-end';

/** A draggable window bar shared by LOQ rows and resource rows: drag the body to move both dates,
 * drag an edge to resize one side. Positions/drags on the shared (window, pxPerDay) model exactly
 * like the project timeline's ProjectBar, so a day-precise drag works at any zoom. Commits are
 * always explicit ISO dates — dragging a LOQ's implicit finish turns it into an explicit
 * committedFinish, per the V1 direct-write decision. */
function WindowBar({
  start, finish, window, pxPerDay, color, label, onCommit, onClick,
}: {
  start: string;
  finish: string;
  window: Period[];
  pxPerDay: number;
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
  const left = xForIsoDate(curStart, window, pxPerDay);
  const width = Math.max(pxPerDay * 3, xForIsoDate(isoAddDays(curFinish, 1), window, pxPerDay) - left);

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
    const deltaDays = Math.round((e.clientX - drag.startX) / pxPerDay);
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

/** Read-only overlay for a LOQ's forecast window, drawn alongside the committed WindowBar whenever
 * the forecast has actually diverged from committed (delta !== 0). Never draggable — the forecast is
 * derived, not an editable commitment. */
function ForecastBar({ forecast, window, pxPerDay }: { forecast: LoqForecast; window: Period[]; pxPerDay: number }) {
  if (!forecast.forecastStart || !forecast.forecastFinish || forecast.deltaDays === 0) return null;
  const left = xForIsoDate(forecast.forecastStart, window, pxPerDay);
  const width = Math.max(pxPerDay * 3, xForIsoDate(isoAddDays(forecast.forecastFinish, 1), window, pxPerDay) - left);
  const tone = forecast.deltaDays > 0 ? (forecast.deltaDays >= 5 ? 'critical' : 'warning') : 'info';
  const badge = `${forecast.deltaDays > 0 ? '+' : ''}${forecast.deltaDays}d`;

  return (
    <div
      className={`loq-forecast-bar loq-forecast-bar-${tone}`}
      style={{ left, width }}
      title={`Forecast (${forecast.source}): ${forecast.forecastStart} → ${forecast.forecastFinish} (${badge})`}
    >
      <span className={`loq-forecast-badge loq-forecast-badge-${tone}`}>{badge}</span>
    </div>
  );
}

function ResourceRow({ resource, window, pxPerDay, trackWidth }: { resource: LoqResource; window: Period[]; pxPerDay: number; trackWidth: number }) {
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
              window={window}
              pxPerDay={pxPerDay}
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

function LoqRow({ loq, window, pxPerDay, trackWidth, forecast, onEditLoq, onRecommit }: {
  loq: Loq;
  window: Period[];
  pxPerDay: number;
  trackWidth: number;
  forecast: LoqForecast | undefined;
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
              window={window}
              pxPerDay={pxPerDay}
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
          {loq.committedStart && finish && forecast && <ForecastBar forecast={forecast} window={window} pxPerDay={pxPerDay} />}
        </div>
      </div>
      {expanded && (
        <div className="loq-resource-rows">
          {resources.map((r) => <ResourceRow key={r.id} resource={r} window={window} pxPerDay={pxPerDay} trackWidth={trackWidth} />)}
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
 * Drag editor for a cinematic's LOQs: one bar per LOQ spanning its committed window (falling back to
 * the implicit estimateDays-derived finish), expandable to its LoqResource windows. Shares the
 * project timeline's (window, pxPerDay) positioning model and its zoom affordance (TimelineZoomControl
 * + Ctrl+scroll), so the two views behave alike. The default view fits the whole plan — first LOQ
 * −2 weeks to last planned finish +2 weeks — and re-fits whenever the cinematic changes; a manual
 * zoom is kept until then (not persisted), and the Fit button returns to the overview.
 *
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
  const engine = useStore((s) => s.engine);
  const forecasts = engine.cinematicLoqForecasts(cinematicId);
  const loqIds = new Set(loqs.map((l) => l.id));
  const relevantResources = loqResources.filter((r) => loqIds.has(r.loqId));

  // 'fit' = auto-fit to the container (the default); a number = a manual zoom %. Not persisted, and
  // the parent keys this component on cinematicId, so switching cinematics remounts it back to 'fit'.
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // observe() delivers an initial measurement, so there's no need to read clientWidth
    // synchronously here. Where ResizeObserver is absent (jsdom), width stays 0 and the fit zoom
    // falls back to the default scale.
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { minIso, maxIso } = computeDateRange(loqs, relevantResources);
  const window = monthWindowForIsoRange(minIso, maxIso);
  const spanDays = Math.max(1, totalWindowWidth(window, 1));

  // At fit, derive the zoom that makes the whole window fill the track area; fall back to the
  // default scale before the container has been measured (first paint, jsdom with no layout).
  const fitZoom = containerWidth > 0
    ? fitZoomForWidth(containerWidth - LABEL_W, spanDays, { min: TIMELINE_ZOOM_MIN, max: TIMELINE_ZOOM_MAX })
    : TIMELINE_ZOOM_DEFAULT;
  const effectiveZoom = zoom === 'fit' ? fitZoom : zoom;
  const pxPerDay = pxPerDayForZoom(effectiveZoom);

  const granularity = timelineGranularity(pxPerDay);
  const fineTicks = fineAxisTicks(window, granularity);
  const trackWidth = totalWindowWidth(window, pxPerDay);
  const today = todayIso();
  const todayX = xForIsoDate(today, window, pxPerDay);

  return (
    <div className="loq-timeline">
      <div className="loq-timeline-toolbar">
        <p className="loq-timeline-hint">
          <Icon name="info" size={12} />
          Drag a bar to move it, drag its edges to resize. Click a LOQ's bar to edit it; expand a row to assign people.
        </p>
        <div className="loq-timeline-tools">
          <TimelineZoomControl zoom={effectiveZoom} min={TIMELINE_ZOOM_MIN} max={TIMELINE_ZOOM_MAX} onChange={setZoom} />
          {zoom !== 'fit' && (
            <Button variant="ghost" size="sm" icon="timeline" onClick={() => setZoom('fit')}>Fit</Button>
          )}
        </div>
      </div>
      <div
        className="loq-timeline-scroll"
        ref={scrollRef}
        onWheel={(e: WheelEvent<HTMLDivElement>) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          setZoom(zoomAfterWheel(effectiveZoom, e.deltaY, { min: TIMELINE_ZOOM_MIN, max: TIMELINE_ZOOM_MAX }));
        }}
      >
        <div className="loq-timeline-inner" style={{ width: LABEL_W + trackWidth, '--loq-label-w': `${LABEL_W}px` } as CSSProperties}>
          {today >= minIso && today <= maxIso && (
            <div className="loq-timeline-today-line" style={{ left: LABEL_W + todayX }} title="Today" />
          )}
          {granularity !== 'month' && fineTicks.map((iso) => (
            <div key={`guide-${iso}`} className={`loq-timeline-fine-guide loq-timeline-fine-guide-${granularity}`} style={{ left: LABEL_W + xForIsoDate(iso, window, pxPerDay) }} />
          ))}

          <div className="loq-timeline-header">
            <div className="loq-timeline-corner" />
            <div className="loq-timeline-months" style={{ width: trackWidth }}>
              {window.map((period) => (
                <div key={period} className="loq-timeline-month" style={{ width: monthWidthPx(period, pxPerDay) }}>
                  {formatPeriodLabel(period, { withYear: effectiveZoom >= 130 })}
                </div>
              ))}
            </div>
          </div>
          {granularity !== 'month' && (
            <div className="loq-timeline-header loq-timeline-fine-header">
              <div className="loq-timeline-corner loq-timeline-corner-fine" />
              <div className="loq-timeline-fine-row" style={{ width: trackWidth }}>
                {fineTicks.map((iso) => (
                  <div key={iso} className="loq-timeline-fine-tick" style={{ left: xForIsoDate(iso, window, pxPerDay) }}>
                    {isoToDayOfMonth(iso)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="loq-timeline-rows">
            {loqs.map((loq) => (
              <LoqRow
                key={loq.id}
                loq={loq}
                window={window}
                pxPerDay={pxPerDay}
                trackWidth={trackWidth}
                forecast={forecasts.get(loq.id)}
                onEditLoq={onEditLoq}
                onRecommit={onRecommit}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
