import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { getForecast, getForecastWindowPeriods } from '../../engine/forecast';
import { UNASSIGNED_DISCIPLINE_ID, round2 } from '../../engine/planning';
import { formatPeriodLabel } from '../../domain/periods';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { Collapsible } from '../components/Collapsible';

export function Forecast() {
  const engine = useStore((s) => s.engine);
  const [monthsAhead, setMonthsAhead] = useState(6);
  const forecast = useMemo(() => getForecast(engine, monthsAhead), [engine, monthsAhead]);
  const periods = useMemo(() => getForecastWindowPeriods(engine, monthsAhead), [engine, monthsAhead]);

  const disciplineGroups = useMemo(() => {
    const groups = engine.disciplines().map((d) => ({ id: d.id, name: d.name, pools: engine.poolsInDiscipline(d.id) }));
    const unassigned = engine.poolsInDiscipline(UNASSIGNED_DISCIPLINE_ID);
    if (unassigned.length > 0) groups.push({ id: UNASSIGNED_DISCIPLINE_ID, name: 'Unassigned', pools: unassigned });
    return groups.filter((g) => g.pools.length > 0);
  }, [engine]);

  if (engine.pools().length === 0) {
    return <EmptyState icon="forecast" title="Nothing to forecast yet" description="Add disciplines, roles and project requirements in Team to see a capacity forecast." />;
  }

  return (
    <div className="forecast-view">
      <div className="view-header">
        <div>
          <h1>Forecast</h1>
          <p className="view-sub">Deterministic projection of demand against capacity — where staffing problems will happen first</p>
        </div>
        <select value={monthsAhead} onChange={(e) => setMonthsAhead(Number(e.target.value))} className="range-select">
          <option value={3}>Next 3 months</option>
          <option value={6}>Next 6 months</option>
          <option value={12}>Next 12 months</option>
        </select>
      </div>

      {forecast.problems.length > 0 && (
        <div className="card forecast-problems">
          <h2><Icon name="warning" size={14} /> Upcoming problems</h2>
          <ul>
            {forecast.problems.map((p) => (
              <li key={`${p.poolId}-${p.period}`}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card forecast-matrix-card">
        <div className="table-scroll">
          <table className="forecast-matrix">
            <thead>
              <tr>
                <th className="matrix-row-label">Emploi repère</th>
                {forecast.periods.map((p) => <th key={p}>{formatPeriodLabel(p, { withYear: false })}</th>)}
              </tr>
            </thead>
            <tbody>
              {forecast.rows.map((row) => (
                <tr key={row.poolId}>
                  <td className="matrix-row-label">{row.poolName}</td>
                  {row.cells.map((cell) => (
                    <td key={cell.period} className={`matrix-cell matrix-${cell.status}`}>
                      <span className="matrix-pct">{cell.utilizationPct}%</span>
                      <span className="matrix-detail">{cell.required}/{cell.capacity}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="matrix-legend">
          <span><i className="legend-swatch matrix-healthy" /> Healthy (&lt;90%)</span>
          <span><i className="legend-swatch matrix-warning" /> Tight (90–100%)</span>
          <span><i className="legend-swatch matrix-critical" /> Over capacity (&gt;100%)</span>
        </div>
      </div>

      <h2 className="forecast-detail-heading">Capacity detail</h2>
      <div className="capacity-disciplines">
        {disciplineGroups.map((group) => (
          <Collapsible
            key={group.id}
            scopeKey={`forecast:disc:${group.id}`}
            className="card discipline-detail-card"
            defaultOpen={disciplineGroups.length === 1}
            summary={<span className="discipline-detail-name">{group.name}</span>}
            count={group.pools.length}
          >
            <div className="capacity-pools">
              {group.pools.map((pool) => (
                <div key={pool.id} className="capacity-pool-card">
                  <div className="capacity-pool-header">
                    <span className="pool-dot" style={{ background: pool.color }} />
                    <h3>{pool.name}</h3>
                  </div>
                  <table className="data-table capacity-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Capacity</th>
                        <th>Required</th>
                        <th>Assigned</th>
                        <th>Available</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((period) => {
                        const capacity = engine.getCapacity(pool.id, period);
                        const required = engine.getRequiredCapacity(pool.id, period);
                        const assigned = engine.getAssignedCapacity(pool.id, period);
                        const available = round2(capacity - assigned);
                        const gap = round2(capacity - required);
                        const overBy = round2(-gap);
                        return (
                          <tr key={period}>
                            <td>{formatPeriodLabel(period)}</td>
                            <td>{capacity}</td>
                            <td>{required}</td>
                            <td>{assigned}</td>
                            <td className={available < -0.001 ? 'value-negative' : ''}>{available}</td>
                            <td>
                              {gap < -0.001 ? (
                                <StatusPill tone="critical">Over capacity +{overBy}</StatusPill>
                              ) : assigned < required - 0.001 ? (
                                <StatusPill tone="warning">Understaffed</StatusPill>
                              ) : (
                                <StatusPill tone="neutral">Healthy</StatusPill>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}
