import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { getSanityChecks, type SanityCheck } from '../../engine/validation';
import { getForecastWindowPeriods } from '../../engine/forecast';
import { PlanningEngine, UNASSIGNED_DISCIPLINE_ID, round2 } from '../../engine/planning';
import { addMonths, formatPeriodLabel, periodRange, todayPeriod } from '../../domain/periods';
import type { Period, Person } from '../../domain/types';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Collapsible } from '../components/Collapsible';
import { GlobalFilterBar } from '../components/GlobalFilterBar';
import { LineChart } from '../components/LineChart';
import { useFilteredEngine } from '../hooks/useFilteredEngine';
import { colorForKey } from '../lib/colors';
import type { ImportReport } from '../../import/rpmImport';

export function Dashboard() {
  const { engine, options } = useFilteredEngine();
  const projects = useStore((s) => s.data.projects);
  const lastImportReport = useStore((s) => s.lastImportReport);
  const navigate = useUiStore((s) => s.navigate);
  const openProject = useUiStore((s) => s.openProject);
  const newDatabase = useStore((s) => s.newDatabase);
  const horizonMonths = useUiStore((s) => s.horizonMonths);

  const checks = useMemo(() => getSanityChecks(engine), [engine]);
  const period = todayPeriod();
  const trendPeriods = useMemo(() => getForecastWindowPeriods(engine, horizonMonths), [engine, horizonMonths]);

  if (projects.length === 0) {
    return (
      <EmptyState
        icon="dashboard"
        title="No projects yet"
        description="Create your first project to start planning resources, or load the demo plan to explore the tool."
        action={<Button variant="primary" icon="file-plus" onClick={() => void newDatabase(true)}>Load demo plan</Button>}
      />
    );
  }

  const activeProjects = projects.filter((p) => p.status === 'active' || p.status === 'planned');
  const totalCapacity = engine.getTotalCapacity(period);
  const critical = checks.filter((c) => c.severity === 'critical');
  const warnings = checks.filter((c) => c.severity === 'warning');
  const overCapacityNow = checks.filter((c) => c.category === 'over_capacity' && c.period === period);
  const understaffedProjectIds = new Set(
    checks.filter((c) => c.category === 'understaffed_project' || c.category === 'unstaffed_requirement').map((c) => c.projectId),
  );
  const overAllocatedProjectIds = new Set(checks.filter((c) => c.category === 'over_allocated').map((c) => c.projectId));
  const unstaffedPeople = checks.filter((c) => c.category === 'unstaffed_person');

  const groupedChecks: { id: string; name: string; checks: SanityCheck[] }[] = [];
  {
    const groups = new Map<string, { id: string; name: string; checks: SanityCheck[] }>();
    for (const check of checks) {
      const id = check.disciplineId ?? '__other__';
      const name = check.disciplineName ?? 'Other';
      if (!groups.has(id)) groups.set(id, { id, name, checks: [] });
      groups.get(id)!.checks.push(check);
    }
    groupedChecks.push(...groups.values());
  }

  return (
    <div className="dashboard">
      <div className="dashboard-topbar">
        <GlobalFilterBar options={options} />
        {lastImportReport && lastImportReport.warnings.length > 0 && <ImportQualityBadge report={lastImportReport} />}
      </div>

      <div className="kpi-row">
        <KpiTile label="Active projects" value={String(activeProjects.length)} icon="projects" />
        <KpiTile label="Total capacity" value={`${round2(totalCapacity)} FTE`} icon="team" sub={formatPeriodLabel(period)} />
        <KpiTile
          label="Capacity conflicts"
          value={String(overCapacityNow.length)}
          icon="critical"
          tone={overCapacityNow.length > 0 ? 'critical' : 'neutral'}
          sub={formatPeriodLabel(period)}
        />
        <KpiTile
          label="Understaffed projects"
          value={String(understaffedProjectIds.size)}
          icon="warning"
          tone={understaffedProjectIds.size > 0 ? 'warning' : 'neutral'}
        />
        <KpiTile
          label="Over-allocated projects"
          value={String(overAllocatedProjectIds.size)}
          icon="warning"
          tone={overAllocatedProjectIds.size > 0 ? 'warning' : 'neutral'}
        />
        <KpiTile
          label="Unstaffed people"
          value={String(unstaffedPeople.length)}
          icon="team"
          tone={unstaffedPeople.length > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="dashboard-grid dashboard-grid-projects">
        <ProjectMix engine={engine} periods={trendPeriods} />
        <ProjectCapacity engine={engine} />
      </div>

      <TeamTensionHeatmap engine={engine} periods={trendPeriods} />
      <NamedAvailability engine={engine} periods={trendPeriods} />

      <div className="dashboard-grid">
        <DisciplineCapacity engine={engine} />

        <section className="card panel">
          <div className="panel-header">
            <h2>Needs attention</h2>
            <span className="panel-sub">{critical.length} critical · {warnings.length} warnings</span>
          </div>
          {checks.length === 0 ? (
            <EmptyState icon="check" title="All clear" description="No capacity conflicts or staffing gaps detected." />
          ) : (
            <div className="issue-groups">
              {groupedChecks.map((group, idx) => (
                <Collapsible
                  key={group.id}
                  scopeKey={`dashboard:need:${group.id}`}
                  className="issue-group"
                  defaultOpen={idx === 0 || group.checks.some((c) => c.severity === 'critical')}
                  summary={<span className="issue-group-name">{group.name}</span>}
                  count={group.checks.length}
                >
                  <ul className="issue-list">
                    {group.checks.map((check) => (
                      <li key={check.id} className="issue-row">
                        <StatusPill tone={check.severity}>{check.severity}</StatusPill>
                        <div className="issue-body">
                          <button
                            type="button"
                            className="issue-message"
                            onClick={() => (check.projectId ? openProject(check.projectId) : navigate('people'))}
                          >
                            {check.message}
                          </button>
                          <div className="issue-impact">{check.impact}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Collapsible>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Monthly stacked breakdown of assigned FTE per project — segment width = share of that month's
 * total. "Mettre en avant" narrows attention to a subset of projects without losing the others. */
function ProjectMix({ engine, periods }: { engine: PlanningEngine; periods: Period[] }) {
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  const projects = useMemo(() => engine.projects(), [engine]);

  const monthly = useMemo(() => periods.map((p) => {
    const rows = projects
      .map((project) => ({ project, value: engine.getProjectAssigned(project.id, p) }))
      .filter((r) => r.value > 0.001)
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    return { period: p, rows, total };
  }), [engine, projects, periods]);

  const activeProjects = useMemo(() => {
    const ids = new Set(monthly.flatMap((m) => m.rows.map((r) => r.project.id)));
    return projects.filter((p) => ids.has(p.id));
  }, [monthly, projects]);

  function toggleHighlight(id: string) {
    setHighlighted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <section className="card panel">
      <div className="panel-header">
        <div className="panel-header-title">
          <h2>Répartition de la capacité par projet</h2>
          <span className="panel-sub">Lecture mensuelle en FTE staffé, par projet · dispo incluse</span>
        </div>
      </div>

      {activeProjects.length === 0 ? (
        <EmptyState icon="projects" title="No assignments yet" description="Assign people to projects to see the monthly breakdown." />
      ) : (
        <>
          <div className="month-stack-list">
            {monthly.map((m) => (
              <div key={m.period} className="month-stack-row">
                <div className="month-stack-label">{formatPeriodLabel(m.period, { withYear: false })}</div>
                <div className="month-stack">
                  {m.rows.map((r) => {
                    const cls = highlighted.size ? (highlighted.has(r.project.id) ? ' highlighted' : ' dimmed') : '';
                    return (
                      <div
                        key={r.project.id}
                        className={`mix-seg${cls}`}
                        data-tip={`${r.project.name} · ${round2(r.value)} FTE`}
                        style={{ width: `${m.total > 0 ? (100 * r.value) / m.total : 0}%`, background: colorForKey(r.project.id) }}
                      />
                    );
                  })}
                </div>
                <div className="month-stack-total">Total · {round2(m.total)} FTE</div>
              </div>
            ))}
          </div>
          <div className="mix-legend">
            {activeProjects.map((p) => {
              const cls = highlighted.size ? (highlighted.has(p.id) ? ' active' : ' dimmed') : '';
              return (
                <button key={p.id} type="button" className={`mix-legend-item${cls}`} onClick={() => toggleHighlight(p.id)}>
                  <i className="mix-legend-dot" style={{ background: colorForKey(p.id) }} />
                  {p.name}
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

type ProjectMetric = 'staffed' | 'occupancy';
type ProjectCapacityMonths = 12 | 24 | 36;
type ProjectCapacityScope = 'global' | 'projects';

/** Global org-wide occupancy timeline by default (capacity vs. real staffing, or the resulting
 * %), with a switch to the per-project multi-line breakdown (clickable legend, same highlight/dim
 * as ProjectMix) and a non-timeline per-project ranking. */
function ProjectCapacity({ engine }: { engine: PlanningEngine }) {
  const [metric, setMetric] = useState<ProjectMetric>('staffed');
  const [timeline, setTimeline] = useState(true);
  const [scope, setScope] = useState<ProjectCapacityScope>('global');
  const [months, setMonths] = useState<ProjectCapacityMonths>(24);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  const periods = useMemo(() => {
    const start = todayPeriod();
    return periodRange(start, addMonths(start, months - 1));
  }, [months]);

  const projects = useMemo(() => engine.projects().filter((p) => !p.isDispo), [engine]);

  function valueAt(projectId: string, p: Period): number {
    if (metric === 'staffed') return engine.getProjectAssigned(projectId, p);
    const required = engine.getProjectRequired(projectId, p);
    const assigned = engine.getProjectAssigned(projectId, p);
    return required > 0.001 ? Math.min(100, round2((100 * assigned) / required)) : 0;
  }

  const ranked = useMemo(() => {
    return projects
      .map((p) => {
        const avg = periods.length ? periods.reduce((sum, period) => sum + valueAt(p.id, period), 0) / periods.length : 0;
        return { id: p.id, name: p.name, color: colorForKey(p.id), value: round2(avg) };
      })
      .filter((p) => p.value > 0.001)
      .sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, periods, metric, engine]);

  const series = useMemo(() => projects
    .map((p) => ({ id: p.id, label: p.name, color: colorForKey(p.id), values: periods.map((period) => round2(valueAt(p.id, period))) }))
    .filter((s) => s.values.some((v) => v > 0.001)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, periods, metric, engine]);

  const globalSeries = useMemo(() => {
    if (metric === 'staffed') {
      return [
        { id: '__capacity', label: 'Capacité totale', color: 'var(--border-strong)', values: periods.map((p) => round2(engine.getTotalCapacity(p))) },
        { id: '__staffed', label: 'Staffé total', color: 'var(--accent)', values: periods.map((p) => round2(engine.getTotalAssignedExcludingDispo(p))) },
      ];
    }
    return [{
      id: '__occupancy',
      label: 'Occupation globale',
      color: 'var(--accent)',
      values: periods.map((p) => {
        const capacity = engine.getTotalCapacity(p);
        const staffed = engine.getTotalAssignedExcludingDispo(p);
        return capacity > 0.001 ? round2((100 * staffed) / capacity) : 0;
      }),
    }];
  }, [engine, periods, metric]);

  const globalYMax = metric === 'occupancy' ? Math.max(100, ...globalSeries[0].values) : undefined;
  const maxRank = Math.max(1, ...ranked.map((p) => p.value));
  const unit = metric === 'staffed' ? 'FTE' : '%';

  function toggleHighlight(id: string) {
    setHighlighted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const subtitle = !timeline
    ? `${metric === 'staffed' ? 'FTE staffé moyen' : 'Staffé ÷ requis'} par projet · ${months} mois`
    : scope === 'global'
      ? `${metric === 'staffed' ? 'Capacité totale vs staffé' : 'Staffé ÷ capacité, org entière'} · ${months} mois`
      : `${metric === 'staffed' ? 'FTE staffé' : 'Staffé ÷ requis'} par projet · ${months} mois`;

  return (
    <section className="card panel">
      <div className="panel-header panel-header-align-start">
        <div className="panel-header-title">
          <h2>Taux d'occupation</h2>
          <span className="panel-sub">{subtitle}</span>
        </div>
        <div className="widget-controls">
          {timeline && (
            <div className="segmented">
              <button type="button" className={scope === 'global' ? 'active' : ''} onClick={() => setScope('global')}>Globale</button>
              <button type="button" className={scope === 'projects' ? 'active' : ''} onClick={() => setScope('projects')}>Par projet</button>
            </div>
          )}
          <div className="segmented">
            <button type="button" className={metric === 'staffed' ? 'active' : ''} onClick={() => setMetric('staffed')}>FTE staffé</button>
            <button type="button" className={metric === 'occupancy' ? 'active' : ''} onClick={() => setMetric('occupancy')}>Taux d'occupation</button>
          </div>
          <label className="widget-toggle">
            <input type="checkbox" checked={timeline} onChange={(e) => setTimeline(e.target.checked)} />
            Timeline
          </label>
          <select className="range-select" value={months} onChange={(e) => setMonths(Number(e.target.value) as ProjectCapacityMonths)}>
            <option value={12}>12 mois</option>
            <option value={24}>24 mois</option>
            <option value={36}>36 mois</option>
          </select>
        </div>
      </div>

      {!timeline ? (
        ranked.length === 0 ? (
          <EmptyState icon="projects" title="No data" description="No projects with assignments in this window." />
        ) : (
          <div className="rank-list">
            {ranked.map((p) => (
              <div key={p.id} className="rank">
                <div className="rank-head">
                  <span><span className="pool-dot" style={{ background: p.color }} /> {p.name}</span>
                  <strong>{p.value}{unit === '%' ? '%' : ' FTE'}</strong>
                </div>
                <div className="rank-track">
                  <div className="rank-fill" style={{ width: `${(100 * p.value) / maxRank}%`, background: p.color }} />
                </div>
              </div>
            ))}
          </div>
        )
      ) : scope === 'global' ? (
        <>
          <LineChart
            series={globalSeries}
            labels={periods.map((p) => formatPeriodLabel(p, { withYear: false }))}
            unit={unit}
            yMax={globalYMax}
            showArea={metric === 'occupancy'}
          />
          {metric === 'staffed' && (
            <div className="mix-legend">
              {globalSeries.map((s) => (
                <span key={s.id} className="mix-legend-item">
                  <i className="mix-legend-dot" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </>
      ) : series.length === 0 ? (
        <EmptyState icon="projects" title="No data" description="No projects with assignments in this window." />
      ) : (
        <>
          <LineChart
            series={series}
            labels={periods.map((p) => formatPeriodLabel(p, { withYear: false }))}
            unit={unit}
            yMax={metric === 'occupancy' ? 100 : undefined}
            highlightedIds={highlighted}
          />
          <div className="mix-legend">
            {projects.filter((p) => series.some((s) => s.id === p.id)).map((p) => {
              const cls = highlighted.size ? (highlighted.has(p.id) ? ' active' : ' dimmed') : '';
              return (
                <button key={p.id} type="button" className={`mix-legend-item${cls}`} onClick={() => toggleHighlight(p.id)}>
                  <i className="mix-legend-dot" style={{ background: colorForKey(p.id) }} />
                  {p.name}
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/** Team × month tension heatmap — grouped by "site · team" (free-text, independent of the pool
 * hierarchy). Cell = real staffing ÷ team capacity that month; redder = less slack. */
function TeamTensionHeatmap({ engine, periods }: { engine: PlanningEngine; periods: Period[] }) {
  const teams = useMemo(() => {
    const people = engine.people().filter((p) => p.active && p.capacityFte > 0.001);
    const map = new Map<string, { label: string; people: Person[] }>();
    for (const person of people) {
      const label = `${person.site.trim() || '—'} · ${person.team.trim() || '—'}`;
      if (!map.has(label)) map.set(label, { label, people: [] });
      map.get(label)!.people.push(person);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [engine]);

  function tierClass(rate: number | null): string {
    if (rate === null) return 'hcell-empty';
    if (rate < 0.75) return 'hcell-low';
    if (rate < 0.9) return 'hcell-mid';
    if (rate < 0.98) return 'hcell-high';
    return 'hcell-crit';
  }

  return (
    <section className="card panel">
      <div className="panel-header">
        <div className="panel-header-title">
          <h2>Carte de tension des équipes</h2>
          <span className="panel-sub">Plus une cellule est rouge, moins l'équipe conserve de marge de manœuvre</span>
        </div>
      </div>
      {teams.length === 0 ? (
        <EmptyState icon="team" title="No teams" description="No active people with a team/site assigned." />
      ) : (
        <div className="heat-wrap">
          <table className="heat">
            <thead>
              <tr>
                <th>Équipe</th>
                {periods.map((p) => <th key={p}>{formatPeriodLabel(p, { withYear: false })}</th>)}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const cap = round2(t.people.reduce((sum, p) => sum + p.capacityFte, 0));
                return (
                  <tr key={t.label}>
                    <td className="heat-team">{t.label}</td>
                    {periods.map((period) => {
                      const staffed = round2(t.people.reduce((sum, p) => sum + engine.getPersonAssignedExcludingDispo(p.id, period), 0));
                      const rate = cap > 0.001 ? staffed / cap : null;
                      return (
                        <td key={period} className={`hcell ${tierClass(rate)}`} title={`${staffed} / ${cap} FTE`}>
                          {rate === null ? '—' : `${Math.round(rate * 100)}%`}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface AvailabilityRun {
  personId: string;
  personName: string;
  role: string;
  teamLabel: string;
  start: Period;
  end: Period;
  months: number;
}

/** Continuous windows where a person carries no real (non-dispo) staffing — either explicitly
 * parked on a "dispo" project or simply unassigned that month. */
function NamedAvailability({ engine, periods }: { engine: PlanningEngine; periods: Period[] }) {
  const runs = useMemo(() => {
    const people = engine.people().filter((p) => p.active && p.capacityFte > 0.001);
    const result: AvailabilityRun[] = [];
    for (const person of people) {
      const pool = person.poolId ? engine.pool(person.poolId) : undefined;
      const teamLabel = `${person.site.trim() || '—'} · ${person.team.trim() || '—'}`;
      let runStart: Period | null = null;
      let runLen = 0;
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        const isAvailable = engine.getPersonAssignedExcludingDispo(person.id, period) < 0.001;
        if (isAvailable) {
          if (runStart === null) runStart = period;
          runLen += 1;
        }
        const isLastPeriod = i === periods.length - 1;
        if ((!isAvailable || isLastPeriod) && runStart !== null) {
          const end = isAvailable ? period : periods[i - 1];
          result.push({ personId: person.id, personName: person.name, role: pool?.name ?? '—', teamLabel, start: runStart, end, months: runLen });
          runStart = null;
          runLen = 0;
        }
      }
    }
    return result.sort((a, b) => b.months - a.months || (a.start < b.start ? -1 : 1)).slice(0, 80);
  }, [engine, periods]);

  return (
    <section className="card panel">
      <div className="panel-header">
        <div className="panel-header-title">
          <h2>Disponibilités nominatives</h2>
          <span className="panel-sub">Fenêtres continues où la personne n'est sur aucun projet réel</span>
        </div>
      </div>
      {runs.length === 0 ? (
        <EmptyState icon="team" title="No availability" description="No continuous availability windows in this horizon." />
      ) : (
        <div className="scroll">
          <div className="availability-row head">
            <span>Personne</span>
            <span>Métier</span>
            <span>Équipe</span>
            <span>Début</span>
            <span>Fin</span>
            <span>Durée</span>
          </div>
          {runs.map((r, i) => (
            <div key={`${r.personId}-${i}`} className="availability-row">
              <span>{r.personName}</span>
              <span>{r.role}</span>
              <span>{r.teamLabel}</span>
              <span>{formatPeriodLabel(r.start, { withYear: false })}</span>
              <span>{formatPeriodLabel(r.end, { withYear: false })}</span>
              <span><span className="pill pill-avail">{r.months} mois</span></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type CapacityMetric = 'staffed' | 'capacity';
type CapacityMonths = 12 | 24 | 36;

/** Ranked (or, in Timeline mode, per-month) capacity by discipline — "métier" in this app's own
 * vocabulary means role/pool, but this widget mirrors the reference's job-family view, which groups
 * by discipline ("famille d'emplois"), per the user's explicit choice. */
function DisciplineCapacity({ engine }: { engine: PlanningEngine }) {
  const [metric, setMetric] = useState<CapacityMetric>('staffed');
  const [timeline, setTimeline] = useState(false);
  const [months, setMonths] = useState<CapacityMonths>(24);

  const periods = useMemo(() => {
    const start = todayPeriod();
    return periodRange(start, addMonths(start, months - 1));
  }, [months]);

  const groups = useMemo(() => {
    const list = engine.disciplines().map((d) => ({ id: d.id, name: d.name, color: d.color }));
    if (engine.pools().some((p) => p.disciplineId === null)) {
      list.push({ id: UNASSIGNED_DISCIPLINE_ID, name: 'Unassigned', color: '#9ca3af' });
    }
    return list;
  }, [engine]);

  function valueAt(disciplineId: string, p: Period): number {
    return metric === 'staffed' ? engine.getDisciplineAssignedCapacity(disciplineId, p) : engine.getDisciplineCapacity(disciplineId, p);
  }

  const ranked = useMemo(() => {
    return groups
      .map((g) => {
        const avg = periods.length ? periods.reduce((sum, p) => sum + valueAt(g.id, p), 0) / periods.length : 0;
        return { ...g, value: round2(avg) };
      })
      .filter((g) => g.value > 0.001)
      .sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, periods, metric, engine]);

  const series = useMemo(() => groups
    .map((g) => ({ id: g.id, label: g.name, color: g.color, values: periods.map((p) => round2(valueAt(g.id, p))) }))
    .filter((s) => s.values.some((v) => v > 0.001)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, periods, metric, engine]);

  const maxRank = Math.max(1, ...ranked.map((g) => g.value));

  return (
    <section className="card panel">
      <div className="panel-header panel-header-align-start">
        <div className="panel-header-title">
          <h2>Capacité moyenne par métier</h2>
          <span className="panel-sub">{metric === 'staffed' ? 'FTE staffé moyen' : 'Capacité moyenne'} · {months} mois</span>
        </div>
        <div className="widget-controls">
          <div className="segmented">
            <button type="button" className={metric === 'staffed' ? 'active' : ''} onClick={() => setMetric('staffed')}>Staffé moyen</button>
            <button type="button" className={metric === 'capacity' ? 'active' : ''} onClick={() => setMetric('capacity')}>Capacité moyenne</button>
          </div>
          <label className="widget-toggle">
            <input type="checkbox" checked={timeline} onChange={(e) => setTimeline(e.target.checked)} />
            Timeline
          </label>
          <select className="range-select" value={months} onChange={(e) => setMonths(Number(e.target.value) as CapacityMonths)}>
            <option value={12}>12 mois</option>
            <option value={24}>24 mois</option>
            <option value={36}>36 mois</option>
          </select>
        </div>
      </div>

      {ranked.length === 0 ? (
        <EmptyState icon="team" title="No capacity" description="No disciplines with capacity in this window." />
      ) : timeline ? (
        <>
          <LineChart series={series} labels={periods.map((p) => formatPeriodLabel(p, { withYear: false }))} unit="FTE" />
          <div className="mix-legend">
            {groups.filter((g) => series.some((s) => s.id === g.id)).map((g) => (
              <span key={g.id} className="mix-legend-item">
                <i className="mix-legend-dot" style={{ background: g.color }} />
                {g.name}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="rank-list">
          {ranked.map((g) => (
            <div key={g.id} className="rank">
              <div className="rank-head">
                <span><span className="pool-dot" style={{ background: g.color }} /> {g.name}</span>
                <strong>{g.value} FTE</strong>
              </div>
              <div className="rank-track">
                <div className="rank-fill" style={{ width: `${(100 * g.value) / maxRank}%`, background: g.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ImportQualityBadge({ report }: { report: ImportReport }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="quality-badge-wrap" ref={ref}>
      <button type="button" className="quality-badge" onClick={() => setOpen((v) => !v)}>
        <Icon name="warning" size={13} />
        {report.warnings.length} signal{report.warnings.length === 1 ? '' : 's'} to review since last import
      </button>
      {open && (
        <div className="quality-badge-popover">
          <ul className="import-warnings">
            {report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value, icon, sub, tone = 'neutral' }: { label: string; value: string; icon: 'projects' | 'team' | 'critical' | 'warning'; sub?: string; tone?: 'critical' | 'warning' | 'neutral' }) {
  return (
    <div className={`card kpi-tile tone-${tone}`}>
      <div className="kpi-icon"><Icon name={icon} size={16} /></div>
      <div className="kpi-text">
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}
