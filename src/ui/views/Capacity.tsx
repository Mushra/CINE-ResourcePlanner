import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { getForecastWindowPeriods } from '../../engine/forecast';
import { round2 } from '../../engine/planning';
import { formatPeriodLabel } from '../../domain/periods';
import { EmptyState } from '../components/EmptyState';
import { StatusPill } from '../components/StatusPill';

export function Capacity() {
  const engine = useStore((s) => s.engine);
  const pools = engine.pools();
  const [monthsAhead, setMonthsAhead] = useState(6);
  const periods = useMemo(() => getForecastWindowPeriods(engine, monthsAhead), [engine, monthsAhead]);

  if (pools.length === 0) {
    return <EmptyState icon="capacity" title="No resource pools yet" description="Add resource pools (disciplines) to see capacity over time." />;
  }

  return (
    <div className="capacity-view">
      <div className="view-header">
        <div>
          <h1>Resource Capacity</h1>
          <p className="view-sub">Capacity, demand and headroom by discipline, month by month</p>
        </div>
        <select value={monthsAhead} onChange={(e) => setMonthsAhead(Number(e.target.value))} className="range-select">
          <option value={3}>Next 3 months</option>
          <option value={6}>Next 6 months</option>
          <option value={12}>Next 12 months</option>
        </select>
      </div>

      <div className="capacity-pools">
        {pools.map((pool) => (
          <div key={pool.id} className="card capacity-pool-card">
            <div className="capacity-pool-header">
              <span className="pool-dot" style={{ background: pool.color }} />
              <h2>{pool.name}</h2>
              <span className="capacity-flat">Base capacity: {pool.capacityFte} FTE</span>
            </div>
            <table className="data-table capacity-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Capacity</th>
                  <th>Required</th>
                  <th>Allocated</th>
                  <th>Available</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => {
                  const capacity = engine.getCapacity(pool.id, period);
                  const required = engine.getRequiredCapacity(pool.id, period);
                  const allocated = engine.getAssignedCapacity(pool.id, period);
                  const available = round2(capacity - allocated);
                  const gap = round2(capacity - required);
                  const overBy = round2(-gap);
                  return (
                    <tr key={period}>
                      <td>{formatPeriodLabel(period)}</td>
                      <td>{capacity}</td>
                      <td>{required}</td>
                      <td>{allocated}</td>
                      <td className={available < -0.001 ? 'value-negative' : ''}>{available}</td>
                      <td>
                        {gap < -0.001 ? (
                          <StatusPill tone="critical">Over capacity +{overBy}</StatusPill>
                        ) : allocated < required - 0.001 ? (
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
    </div>
  );
}
