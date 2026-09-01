import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { getForecast } from '../../engine/forecast';
import { formatPeriodLabel } from '../../domain/periods';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';

export function Forecast() {
  const engine = useStore((s) => s.engine);
  const [monthsAhead, setMonthsAhead] = useState(6);
  const forecast = useMemo(() => getForecast(engine, monthsAhead), [engine, monthsAhead]);

  if (engine.pools().length === 0) {
    return <EmptyState icon="forecast" title="Nothing to forecast yet" description="Add resource pools and project requirements to see a capacity forecast." />;
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
                <th className="matrix-row-label">Discipline</th>
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
    </div>
  );
}
