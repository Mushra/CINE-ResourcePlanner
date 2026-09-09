import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { getSanityChecks, type SanityCheck } from '../../engine/validation';
import { getForecastWindowPeriods, utilizationStatus } from '../../engine/forecast';
import { round2 } from '../../engine/planning';
import { todayPeriod, formatPeriodLabel } from '../../domain/periods';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Collapsible } from '../components/Collapsible';
import { GlobalFilterBar } from '../components/GlobalFilterBar';
import { useFilteredEngine } from '../hooks/useFilteredEngine';
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
  const trend = useMemo(() => trendPeriods.map((p) => {
    const pools = engine.pools();
    const capacity = pools.reduce((sum, pool) => sum + engine.getCapacity(pool.id, p), 0);
    const required = pools.reduce((sum, pool) => sum + engine.getRequiredCapacity(pool.id, p), 0);
    const pct = capacity > 0 ? round2((required / capacity) * 100) : required > 0 ? 999 : 0;
    return { period: p, pct, status: utilizationStatus(pct) };
  }), [engine, trendPeriods]);

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
  const totalCapacity = engine.pools().reduce((sum, p) => sum + engine.getCapacity(p.id, period), 0);
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

      <section className="card panel trend-panel">
        <div className="panel-header">
          <h2>Occupation dans le temps</h2>
          <span className="panel-sub">Required demand as a share of total capacity, per month</span>
        </div>
        <div className="utilization-list">
          {trend.map((t) => (
            <div key={t.period} className="utilization-row">
              <div className="utilization-label">{formatPeriodLabel(t.period, { withYear: false })}</div>
              <div className="utilization-track">
                <div className={`utilization-fill fill-${t.status}`} style={{ width: `${Math.min(100, t.pct)}%` }} />
                {t.pct > 100 && <div className="utilization-overflow" style={{ left: '100%' }} />}
              </div>
              <div className="utilization-pct">{t.pct}%</div>
            </div>
          ))}
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="card panel">
          <div className="panel-header">
            <h2>Portfolio health — {formatPeriodLabel(period)}</h2>
            <span className="panel-sub">Required demand as a share of capacity, this month</span>
          </div>
          <div className="utilization-list">
            {engine.pools().map((pool) => {
              const capacity = engine.getCapacity(pool.id, period);
              const required = engine.getRequiredCapacity(pool.id, period);
              const pct = capacity > 0 ? round2((required / capacity) * 100) : required > 0 ? 999 : 0;
              const status = utilizationStatus(pct);
              return (
                <div key={pool.id} className="utilization-row">
                  <div className="utilization-label">
                    <span className="pool-dot" style={{ background: pool.color }} />
                    {pool.name}
                  </div>
                  <div className="utilization-track">
                    <div
                      className={`utilization-fill fill-${status}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                    {pct > 100 && <div className="utilization-overflow" style={{ left: '100%' }} />}
                  </div>
                  <div className="utilization-pct">{pct}%</div>
                </div>
              );
            })}
          </div>
        </section>

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
                            onClick={() => (check.projectId ? openProject(check.projectId) : navigate('forecast'))}
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
