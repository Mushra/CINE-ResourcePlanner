import { useState } from 'react';
import { useStore } from '../../../store/useStore';
import { useUiStore } from '../../../store/useUiStore';
import { isoDiffDays } from '../../timeline/timelineMath';
import {
  HEALTH_LABEL, HEALTH_ORDER, cinematicHealth, deriveLoqHealth, healthCounts, loqLevelDistribution,
  projectAttention, representativeLoq, type AttentionItem, type WatchtowerHealth,
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
  const disciplines = useStore((s) => s.data.disciplines);
  const allCinematics = useStore((s) => s.data.cinematics);
  const allLoqs = useStore((s) => s.data.loqs);
  const openCinematic = useUiStore((s) => s.openCinematic);
  const [healthFilter, setHealthFilter] = useState<WatchtowerHealth | null>(null);
  const [distDiscipline, setDistDiscipline] = useState<string>('all');

  const cinematics = allCinematics.filter((c) => c.projectId === project.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const cinematicIds = new Set(cinematics.map((c) => c.id));
  const loqs = allLoqs.filter((l) => cinematicIds.has(l.cinematicId));
  const disciplineIds = disciplines.filter((d) => loqs.some((l) => l.disciplineId === d.id)).map((d) => d.id);
  const disciplineName = (id: string) => disciplines.find((d) => d.id === id)?.name ?? id;
  const forecasts = engine.getLoqForecasts();

  const counts = healthCounts(cinematics, disciplineIds, loqs, forecasts);

  function itemHealth(item: AttentionItem): WatchtowerHealth | null {
    const disciplineId = item.check.disciplineId;
    if (!item.cinematicId || !disciplineId) return null;
    const loq = representativeLoq(loqs, item.cinematicId, disciplineId);
    return loq ? deriveLoqHealth(loq, forecasts.get(loq.id)) : null;
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
    ? cinematics.filter((c) => cinematicHealth(c.id, disciplineIds, loqs, forecasts) === healthFilter)
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
          <h2>LOQ delivery outlook</h2>
          <span className="panel-sub">Forecast finish vs. target date, per discipline</span>
        </div>
        <LoqOutlook
          cinematics={outlookCinematics}
          disciplineIds={disciplineIds}
          disciplineName={disciplineName}
          loqs={loqs}
          forecasts={forecasts}
          healthFilter={healthFilter}
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

function LoqOutlook({
  cinematics, disciplineIds, disciplineName, loqs, forecasts, healthFilter, onOpenCinematic,
}: {
  cinematics: Cinematic[];
  disciplineIds: string[];
  disciplineName: (id: string) => string;
  loqs: Loq[];
  forecasts: ReadonlyMap<string, LoqForecast>;
  healthFilter: WatchtowerHealth | null;
  onOpenCinematic: (id: string) => void;
}) {
  const rows = cinematics.map((cinematic) => ({
    cinematic,
    cells: disciplineIds
      .map((disciplineId) => {
        const loq = representativeLoq(loqs, cinematic.id, disciplineId);
        if (!loq) return null;
        const forecast = forecasts.get(loq.id);
        const date = forecast?.forecastFinish ?? loq.committedFinish ?? loq.actualFinish ?? null;
        if (!date) return null;
        return { disciplineId, loq, date, health: deriveLoqHealth(loq, forecast) };
      })
      .filter((c): c is { disciplineId: string; loq: Loq; date: string; health: WatchtowerHealth } => c !== null),
  })).filter((row) => row.cells.length > 0);

  const allDates = [
    ...rows.flatMap((r) => r.cells.map((c) => c.date)),
    ...rows.map((r) => r.cinematic.targetDate).filter((d): d is string => d !== null),
  ];

  if (allDates.length === 0) {
    return <p className="empty-inline">No forecastable LOQs yet.</p>;
  }

  const sorted = [...allDates].sort();
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];
  const totalDays = Math.max(1, isoDiffDays(minDate, maxDate));
  const padDays = Math.max(2, Math.round(totalDays * 0.08));
  const windowDays = totalDays + padDays * 2;

  function pct(date: string): number {
    const offset = isoDiffDays(minDate, date) + padDays;
    return Math.max(0, Math.min(100, (offset / windowDays) * 100));
  }

  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const offsetDays = Math.round((i / (tickCount - 1)) * (totalDays + padDays * 2)) - padDays;
    const iso = new Date(new Date(`${minDate}T00:00:00Z`).getTime() + offsetDays * 86400000).toISOString().slice(0, 10);
    return iso;
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
                {row.cinematic.targetDate && <div className="outlook-target-mark" style={{ left: `${pct(row.cinematic.targetDate)}%` }} />}
                <div
                  className={`outlook-dot ${healthFilter && cell.health !== healthFilter ? 'dimmed' : ''}`}
                  style={{ left: `${pct(cell.date)}%`, background: `var(--wt-${cell.health})` }}
                  title={`${row.cinematic.name} · ${disciplineName(cell.disciplineId)}\nStatus: ${cell.loq.status}\nHealth: ${HEALTH_LABEL[cell.health]}\nForecast finish: ${cell.date}`}
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
