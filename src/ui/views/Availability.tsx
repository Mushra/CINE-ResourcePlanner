import { useMemo } from 'react';
import { useUiStore } from '../../store/useUiStore';
import { getForecastWindowPeriods } from '../../engine/forecast';
import { round2 } from '../../engine/planning';
import { formatPeriodLabel } from '../../domain/periods';
import { EmptyState } from '../components/EmptyState';
import { GlobalFilterBar } from '../components/GlobalFilterBar';
import { useFilteredEngine } from '../hooks/useFilteredEngine';

interface AvailabilityRow {
  personId: string;
  personName: string;
  poolName: string;
  site: string;
  totalAvailable: number;
  byPeriod: Map<string, number>;
}

export function Availability() {
  const { engine, options } = useFilteredEngine();
  const horizonMonths = useUiStore((s) => s.horizonMonths);
  const periods = useMemo(() => getForecastWindowPeriods(engine, horizonMonths), [engine, horizonMonths]);

  const rows = useMemo<AvailabilityRow[]>(() => {
    const result: AvailabilityRow[] = [];
    for (const person of engine.people()) {
      if (!person.active || person.capacityFte <= 0.001) continue;
      const byPeriod = new Map<string, number>();
      let totalAvailable = 0;
      let hasSpare = false;
      for (const period of periods) {
        const available = round2(person.capacityFte - engine.getPersonAssignedExcludingDispo(person.id, period));
        byPeriod.set(period, available);
        totalAvailable += available;
        if (available > 0.001) hasSpare = true;
      }
      if (!hasSpare) continue;
      const pool = person.poolId ? engine.pool(person.poolId) : undefined;
      result.push({ personId: person.id, personName: person.name, poolName: pool?.name ?? '—', site: person.site || '—', totalAvailable: round2(totalAvailable), byPeriod });
    }
    result.sort((a, b) => b.totalAvailable - a.totalAvailable || a.personName.localeCompare(b.personName));
    return result;
  }, [engine, periods]);

  return (
    <div className="availability-view">
      <div className="view-header">
        <div>
          <h1>Availability</h1>
          <p className="view-sub">Who has spare capacity, where, and when — for staffing the next project</p>
        </div>
      </div>
      <GlobalFilterBar options={options} />
      {rows.length === 0 ? (
        <EmptyState icon="team" title="No spare capacity" description="Everyone active in the current filter is fully assigned over this horizon." />
      ) : (
        <div className="table-scroll">
          <table className="data-table availability-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Site</th>
                {periods.map((p) => <th key={p}>{formatPeriodLabel(p, { withYear: false })}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.personId}>
                  <td className="cell-name">{row.personName}</td>
                  <td>{row.poolName}</td>
                  <td>{row.site}</td>
                  {periods.map((p) => {
                    const available = row.byPeriod.get(p) ?? 0;
                    return (
                      <td key={p} className={available > 0.001 ? 'availability-free' : ''}>
                        {available}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
