import { useMemo, useState } from 'react';
import { useUiStore } from '../../store/useUiStore';
import { getForecastWindowPeriods } from '../../engine/forecast';
import { round2 } from '../../engine/planning';
import { formatPeriodLabel } from '../../domain/periods';
import { EmptyState } from '../components/EmptyState';
import { GlobalFilterBar } from '../components/GlobalFilterBar';
import { useFilteredEngine } from '../hooks/useFilteredEngine';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { downloadCsv } from '../../export/csv';

interface AvailabilityRow {
  personId: string;
  personName: string;
  poolName: string;
  site: string;
  totalAvailable: number;
  byPeriod: Map<string, number>;
}

interface AssignmentRow {
  personId: string;
  personName: string;
  poolName: string;
  site: string;
  projectId: string;
  projectName: string;
  period: string;
  fte: number;
}

/** Who's free and who's on what — two views of the same person x time data, toggled rather than
 * split across separate nav items since they share the filtered engine, horizon, and chrome. */
export function People() {
  const { engine, options } = useFilteredEngine();
  const horizonMonths = useUiStore((s) => s.horizonMonths);
  const mode = useUiStore((s) => s.peopleMode);
  const setMode = useUiStore((s) => s.setPeopleMode);
  const periods = useMemo(() => getForecastWindowPeriods(engine, horizonMonths), [engine, horizonMonths]);

  return (
    <div className="people-view">
      <div className="view-header">
        <div>
          <h1>People</h1>
          <p className="view-sub">
            {mode === 'availability' ? 'Who has spare capacity, where, and when — for staffing the next project' : 'Every person, project, and month in one exportable table'}
          </p>
        </div>
        <div className="people-header-actions">
          <div className="segmented segmented-sm">
            <button type="button" className={mode === 'availability' ? 'active' : ''} onClick={() => setMode('availability')}>Availability</button>
            <button type="button" className={mode === 'assignments' ? 'active' : ''} onClick={() => setMode('assignments')}>Assignments</button>
          </div>
        </div>
      </div>
      <GlobalFilterBar options={options} />
      {mode === 'availability' ? <AvailabilityPanel engine={engine} periods={periods} /> : <AssignmentsPanel engine={engine} periods={periods} />}
    </div>
  );
}

function AvailabilityPanel({ engine, periods }: { engine: ReturnType<typeof useFilteredEngine>['engine']; periods: string[] }) {
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

  if (rows.length === 0) {
    return <EmptyState icon="team" title="No spare capacity" description="Everyone active in the current filter is fully assigned over this horizon." />;
  }

  return (
    <div className="table-scroll">
      <table className="data-table people-table">
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
  );
}

function AssignmentsPanel({ engine, periods }: { engine: ReturnType<typeof useFilteredEngine>['engine']; periods: string[] }) {
  const [search, setSearch] = useState('');

  const allRows = useMemo<AssignmentRow[]>(() => {
    const rows: AssignmentRow[] = [];
    for (const project of engine.projects()) {
      for (const period of periods) {
        for (const line of engine.getProjectPersonStaffing(project.id, period).lines) {
          if (line.fte <= 0.001) continue;
          const person = engine.person(line.personId);
          const pool = line.poolId ? engine.pool(line.poolId) : undefined;
          rows.push({
            personId: line.personId,
            personName: line.personName,
            poolName: pool?.name ?? '—',
            site: person?.site || '—',
            projectId: project.id,
            projectName: project.name,
            period,
            fte: line.fte,
          });
        }
      }
    }
    rows.sort((a, b) =>
      a.personName.localeCompare(b.personName) ||
      a.period.localeCompare(b.period) ||
      a.projectName.localeCompare(b.projectName),
    );
    return rows;
  }, [engine, periods]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) =>
      r.personName.toLowerCase().includes(q) ||
      r.projectName.toLowerCase().includes(q) ||
      r.poolName.toLowerCase().includes(q) ||
      r.site.toLowerCase().includes(q),
    );
  }, [allRows, search]);

  function handleExport() {
    downloadCsv(
      'assignment-detail.csv',
      ['Person', 'Role', 'Site', 'Project', 'Month', 'FTE'],
      rows.map((r) => [r.personName, r.poolName, r.site, r.projectName, formatPeriodLabel(r.period), String(r.fte)]),
    );
  }

  return (
    <>
      <div className="detail-toolbar">
        <div className="detail-search">
          <Icon name="search" size={13} />
          <input placeholder="Search person, project, role, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="detail-toolbar-right">
          <span className="detail-count">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
          <Button icon="download" size="sm" onClick={handleExport} disabled={rows.length === 0}>Export CSV</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="table" title="No assignments" description="No one is assigned to a project in the current filter and time horizon." />
      ) : (
        <div className="table-scroll">
          <table className="data-table people-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Site</th>
                <th>Project</th>
                <th>Month</th>
                <th>FTE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.personId}-${r.projectId}-${r.period}-${i}`}>
                  <td className="cell-name">{r.personName}</td>
                  <td>{r.poolName}</td>
                  <td>{r.site}</td>
                  <td>{r.projectName}</td>
                  <td>{formatPeriodLabel(r.period, { withYear: false })}</td>
                  <td>{r.fte}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
