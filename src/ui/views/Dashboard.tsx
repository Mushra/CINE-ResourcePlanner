import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { useUiStore } from '../../store/useUiStore';
import { getSanityChecks, type SanityCheck } from '../../engine/validation';
import { utilizationStatus } from '../../engine/forecast';
import { round2 } from '../../engine/planning';
import { todayPeriod, formatPeriodLabel } from '../../domain/periods';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Collapsible } from '../components/Collapsible';

export function Dashboard() {
  const engine = useStore((s) => s.engine);
  const projects = useStore((s) => s.data.projects);
  const navigate = useUiStore((s) => s.navigate);
  const openProject = useUiStore((s) => s.openProject);
  const newDatabase = useStore((s) => s.newDatabase);

  const checks = useMemo(() => getSanityChecks(engine), [engine]);
  const period = todayPeriod();

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
