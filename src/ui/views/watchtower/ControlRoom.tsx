import { useState } from 'react';
import { useStore } from '../../../store/useStore';
import { useUiStore } from '../../../store/useUiStore';
import { isoAddMonths, isoDiffDays } from '../../timeline/timelineMath';
import { localTodayIso } from '../../../domain/projectStatus';
import {
  HEALTH_LABEL, HEALTH_ORDER, buildEffectiveStatusMap, cinematicHealth, deriveLoqHealth, healthCounts,
  isTerminalStatus, loqLevelDistribution, loqStatusLabel, projectAttention, representativeLoq, statusResolverFrom,
  type AttentionItem, type StatusResolver, type WatchtowerHealth,
} from '../../../engine/watchtower';
import { Collapsible } from '../../components/Collapsible';
import { EmptyState } from '../../components/EmptyState';
import { StatusPill } from '../../components/StatusPill';
import type { Cinematic, Loq, Project } from '../../../domain/types';
import type { LoqForecast } from '../../../engine/loqForecast';
import type { SanityCheck } from '../../../engine/validation';

/** Severity rank for the Attention panel's "top N by priority" sort — critical first. */
const SEVERITY_RANK: Record<SanityCheck['severity'], number> = { critical: 2, warning: 1, info: 0 };
const ATTENTION_LIMIT = 5;

/**
 * Watchtower's Production → Control Room screen: the prototype's health strip, attention panel,
 * LOQ delivery outlook and LOQ distribution, wired to real engine data. See docs/WATCHTOWER.md for
 * the exact health-derivation rule and the §D mapping this reproduces.
 */
export function ControlRoom({ project, checks }: { project: Project; checks: SanityCheck[] }) {
  const engine = useStore((s) => s.engine);
  const jiraConfigs = useStore((s) => s.jiraConfigs);
  const disciplines = useStore((s) => s.data.disciplines);
  const allCinematics = useStore((s) => s.data.cinematics);
  const allLoqs = useStore((s) => s.data.loqs);
  const openCinematic = useUiStore((s) => s.openCinematic);
  const [healthFilter, setHealthFilter] = useState<WatchtowerHealth | null>(null);
  const [distDiscipline, setDistDiscipline] = useState<string>('all');
  const [outlookHorizon, setOutlookHorizon] = useState<OutlookHorizon>('next-4-months');

  const cinematics = allCinematics.filter((c) => c.projectId === project.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const cinematicIds = new Set(cinematics.map((c) => c.id));
  const loqs = allLoqs.filter((l) => cinematicIds.has(l.cinematicId));
  const disciplineIds = disciplines.filter((d) => loqs.some((l) => l.disciplineId === d.id)).map((d) => d.id);
  const disciplineName = (id: string) => disciplines.find((d) => d.id === id)?.name ?? id;
  const forecasts = engine.getLoqForecasts();
  const statusOf = statusResolverFrom(buildEffectiveStatusMap(engine, jiraConfigs));

  const counts = healthCounts(cinematics, disciplineIds, loqs, forecasts, statusOf);

  function itemHealth(item: AttentionItem): WatchtowerHealth | null {
    const disciplineId = item.check.disciplineId;
    if (!item.cinematicId || !disciplineId) return null;
    const loq = representativeLoq(loqs, item.cinematicId, disciplineId, statusOf);
    return loq ? deriveLoqHealth(loq, forecasts.get(loq.id), statusOf(loq)) : null;
  }

  // Attention Required is planning/Jira issues only — FTE/staffing/capacity issues (source
  // 'Production Planning') surface in the Staffing view instead. See docs/WATCHTOWER.md.
  const planningAttention = projectAttention(engine, checks, project.id).filter((item) => item.source !== 'Production Planning');
  const filteredAttention = healthFilter ? planningAttention.filter((item) => itemHealth(item) === healthFilter) : planningAttention;
  const visibleAttention = [...filteredAttention]
    .sort((a, b) => SEVERITY_RANK[b.check.severity] - SEVERITY_RANK[a.check.severity])
    .slice(0, ATTENTION_LIMIT);
  const attentionGroups: { id: string; name: string; items: AttentionItem[] }[] = [];
  {
    const byId = new Map<string, { id: string; name: string; items: AttentionItem[] }>();
    for (const item of visibleAttention) {
      const id = item.cinematicId ?? '__project__';
      const name = item.cinematicName ?? project.name;
      if (!byId.has(id)) byId.set(id, { id, name, items: [] });
      byId.get(id)!.items.push(item);
    }
    attentionGroups.push(...byId.values());
  }

  const outlookCinematics = healthFilter
    ? cinematics.filter((c) => cinematicHealth(c.id, disciplineIds, loqs, forecasts, statusOf) === healthFilter)
    : cinematics;

  const distribution = loqLevelDistribution(cinematics, disciplineIds, loqs, distDiscipline === 'all' ? null : distDiscipline);
  const distMax = Math.max(...distribution.map((d) => d.count), 1);

  return (
    <>
      <div className="card panel">
        <div className="panel-header">
          <h2>Health</h2>
          <span className="panel-sub">Every discipline's current LOQ across this project's cinematics</span>
        </div>
        <div className="health-strip">
          {HEALTH_ORDER.map((health) => (
            <button
              key={health}
              type="button"
              className={`health-tile ${healthFilter === health ? 'active' : ''}`}
              onClick={() => setHealthFilter((prev) => (prev === health ? null : health))}
            >
              <span className={`health-tile-value health-text-${health}`}>{counts[health]}</span>
              <span className="health-tile-label">{HEALTH_LABEL[health]}</span>
            </button>
          ))}
        </div>
        {healthFilter && (
          <div className="health-clear">
            Filtering on <strong>{HEALTH_LABEL[healthFilter]}</strong>
            <button type="button" onClick={() => setHealthFilter(null)}>Clear filter</button>
          </div>
        )}
      </div>

      <div className="card panel">
        <div className="panel-header">
          <h2>Attention required</h2>
          <span className="panel-sub">Top {visibleAttention.length} of {filteredAttention.length} planning issue{filteredAttention.length === 1 ? '' : 's'}</span>
        </div>
        {attentionGroups.length === 0 ? (
          <EmptyState icon="check" title="All clear" description="No issues match this filter." compact />
        ) : (
          <div className="issue-groups">
            {attentionGroups.map((group, idx) => (
              <Collapsible
                key={group.id}
                scopeKey={`watchtower:attention:${project.id}:${group.id}`}
                className="issue-group"
                defaultOpen={idx === 0 || group.items.some((i) => i.check.severity === 'critical')}
                summary={<span className="issue-group-name">{group.name}</span>}
                count={group.items.length}
              >
                <ul className="issue-list">
                  {group.items.map((item) => (
                    <li key={item.check.id} className="issue-row">
                      <StatusPill tone={item.check.severity}>{item.check.severity}</StatusPill>
                      <div className="issue-body">
                        <button
                          type="button"
                          className="issue-message"
                          disabled={!item.cinematicId}
                          onClick={() => item.cinematicId && openCinematic(item.cinematicId)}
                        >
                          {item.check.disciplineName ? `${item.check.disciplineName} — ` : ''}{item.check.message}
                        </button>
                        <div className="issue-impact">{item.check.impact} · <span className="tbd-inline">{item.source}</span></div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Collapsible>
            ))}
          </div>
        )}
      </div>

      <div className="card panel">
        <div className="panel-header">
          <div className="panel-header-title">
            <h2>LOQ delivery outlook</h2>
            <span className="panel-sub">Upcoming deliveries from today — soonest first, overdue pinned on top</span>
          </div>
          <select className="person-add-select" value={outlookHorizon} onChange={(e) => setOutlookHorizon(e.target.value as OutlookHorizon)}>
            <option value="next-month">Next month</option>
            <option value="next-4-months">Next 4 months</option>
            <option value="all">All upcoming</option>
          </select>
        </div>
        <LoqOutlook
          cinematics={outlookCinematics}
          disciplineIds={disciplineIds}
          disciplineName={disciplineName}
          loqs={loqs}
          forecasts={forecasts}
          statusOf={statusOf}
          healthFilter={healthFilter}
          horizon={outlookHorizon}
          onOpenCinematic={openCinematic}
        />
      </div>

      <div className="card panel">
        <div className="panel-header">
          <h2>Current LOQ distribution</h2>
          <select className="person-add-select" value={distDiscipline} onChange={(e) => setDistDiscipline(e.target.value)}>
            <option value="all">All disciplines</option>
            {disciplineIds.map((id) => <option key={id} value={id}>{disciplineName(id)}</option>)}
          </select>
        </div>
        {distribution.length === 0 ? (
          <p className="empty-inline">No LOQs yet.</p>
        ) : (
          <div className="rank-list">
            {distribution.map((d) => (
              <div key={d.level} className="rank">
                <div className="rank-head">
                  <span>{d.level}</span>
                  <strong>{d.count} CIN{d.count === 1 ? '' : 's'}</strong>
                </div>
                <div className="rank-track">
                  <div className="rank-fill" style={{ width: `${(d.count / distMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Delivery-outlook time window. All three hide the past (start = today); they only bound how far
 * into the future the timeline reaches. Overdue-but-unresolved deliveries always show regardless. */
export type OutlookHorizon = 'next-month' | 'next-4-months' | 'all';

interface OutlookCell {
  disciplineId: string;
  loq: Loq;
  date: string;
  health: WatchtowerHealth;
  /** Delivery date is in the past and the LOQ isn't finished — the most urgent, pinned left + on top. */
  overdue: boolean;
}

function LoqOutlook({
  cinematics, disciplineIds, disciplineName, loqs, forecasts, statusOf, healthFilter, horizon, onOpenCinematic,
}: {
  cinematics: Cinematic[];
  disciplineIds: string[];
  disciplineName: (id: string) => string;
  loqs: Loq[];
  forecasts: ReadonlyMap<string, LoqForecast>;
  statusOf: StatusResolver;
  healthFilter: WatchtowerHealth | null;
  horizon: OutlookHorizon;
  onOpenCinematic: (id: string) => void;
}) {
  const today = localTodayIso();
  // Future horizon end; overdue items ignore it (they always show). 'all' extends to the last date.
  const horizonEnd = horizon === 'next-month' ? isoAddMonths(today, 1) : horizon === 'next-4-months' ? isoAddMonths(today, 4) : null;

  const allRows = cinematics.map((cinematic) => ({
    cinematic,
    cells: disciplineIds
      .map((disciplineId): OutlookCell | null => {
        const loq = representativeLoq(loqs, cinematic.id, disciplineId, statusOf);
        if (!loq) return null;
        const forecast = forecasts.get(loq.id);
        const date = forecast?.forecastFinish ?? loq.committedFinish ?? loq.actualFinish ?? null;
        if (!date) return null;
        const overdue = date < today && !isTerminalStatus(statusOf(loq));
        return { disciplineId, loq, date, health: deriveLoqHealth(loq, forecast, statusOf(loq)), overdue };
      })
      // Hide the past: keep future-or-today deliveries within the horizon, plus every overdue one.
      .filter((c): c is OutlookCell => c !== null && (c.overdue || (c.date >= today && (horizonEnd === null || c.date <= horizonEnd)))),
  })).filter((row) => row.cells.length > 0);

  if (allRows.length === 0) {
    return <p className="empty-inline">No deliveries due in this window.</p>;
  }

  // Soonest delivery per row drives the ordering — overdue rows (earliest dates) rise to the top.
  const earliestOf = (cells: OutlookCell[]) => cells.reduce((min, c) => (c.date < min ? c.date : min), cells[0].date);
  const rows = [...allRows].sort((a, b) => earliestOf(a.cells).localeCompare(earliestOf(b.cells)));

  // Timeline window is anchored at today on the left; overdue dots clamp to the left edge.
  const windowStart = today;
  const futureDates = [
    ...rows.flatMap((r) => r.cells.filter((c) => !c.overdue).map((c) => c.date)),
    ...rows.map((r) => r.cinematic.targetDate).filter((d): d is string => d !== null && d >= today && (horizonEnd === null || d <= horizonEnd)),
  ];
  const windowEnd = horizonEnd ?? (futureDates.length > 0 ? [...futureDates].sort().at(-1)! : isoAddMonths(today, 1));
  const spanDays = Math.max(1, isoDiffDays(windowStart, windowEnd));
  const padDays = Math.max(2, Math.round(spanDays * 0.08));
  const windowDays = spanDays + padDays * 2;

  function pct(date: string): number {
    const offset = isoDiffDays(windowStart, date) + padDays;
    return Math.max(0, Math.min(100, (offset / windowDays) * 100));
  }

  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const offsetDays = Math.round((i / (tickCount - 1)) * windowDays) - padDays;
    return new Date(new Date(`${windowStart}T00:00:00Z`).getTime() + offsetDays * 86400000).toISOString().slice(0, 10);
  });

  return (
    <div className="outlook-scroll">
      <div className="outlook-axis">
        {ticks.map((iso) => (
          <span key={iso}>{new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.cinematic.id} className="outlook-cin">
          <div className="outlook-cin-title" onClick={() => onOpenCinematic(row.cinematic.id)}>
            {row.cinematic.name}
            {row.cinematic.targetDate && <span className="outlook-cin-target">Target {row.cinematic.targetDate}</span>}
          </div>
          {row.cells.map((cell) => (
            <div key={cell.disciplineId} className="outlook-row">
              <span className="outlook-row-label">{disciplineName(cell.disciplineId)}</span>
              <div className="outlook-track">
                {row.cinematic.targetDate && row.cinematic.targetDate >= today && (horizonEnd === null || row.cinematic.targetDate <= horizonEnd) && (
                  <div className="outlook-target-mark" style={{ left: `${pct(row.cinematic.targetDate)}%` }} />
                )}
                <div
                  className={`outlook-dot ${cell.overdue ? 'overdue' : ''} ${healthFilter && cell.health !== healthFilter ? 'dimmed' : ''}`}
                  style={{ left: `${pct(cell.date)}%`, background: `var(--wt-${cell.health})` }}
                  title={`${row.cinematic.name} · ${disciplineName(cell.disciplineId)}${cell.loq.type ? ` · ${cell.loq.type}` : ''}\nStatus: ${loqStatusLabel(cell.loq, statusOf(cell.loq))}\nHealth: ${HEALTH_LABEL[cell.health]}\n${cell.overdue ? 'Overdue since' : 'Forecast finish'}: ${cell.date}`}
                  onClick={() => onOpenCinematic(row.cinematic.id)}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
