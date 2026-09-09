import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import { useStore } from '../../store/useStore';
import type { ImportMode } from '../../db/applyImport';
import type { ImportReport } from '../../import/rpmImport';

export function ImportDrawer({ onClose }: { onClose: () => void }) {
  const importRpm = useStore((s) => s.importRpm);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    const result = await importRpm(mode);
    setBusy(false);
    if (result) setReport(result);
  }

  return (
    <Drawer title="Import export" onClose={onClose} width={460}>
      {report ? (
        <ImportReportView report={report} onClose={onClose} />
      ) : (
        <>
          <p className="drawer-hint">
            Import an RPM production export or a Staffing consolidated workbook (.xlsx) — the
            format is detected automatically. Assigned rows become named people, grouped into
            disciplines and roles — requirements are left empty for you to set.
          </p>

          <div className="import-mode-options">
            <label className="import-mode-option">
              <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span>
                <strong>Merge into current plan</strong>
                <small>Adds missing projects/pools by name and updates matching assignments for the imported months. Everything else is kept.</small>
              </span>
            </label>
            <label className="import-mode-option">
              <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span>
                <strong>Replace current plan</strong>
                <small>Starts a fresh plan containing only what's in the file.</small>
              </span>
            </label>
          </div>

          <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void run()}>
              {busy ? 'Importing…' : 'Choose file & import'}
            </Button>
          </div>
        </>
      )}
    </Drawer>
  );
}

function ImportReportView({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const hasSkips = report.skippedOpen > 0 || report.skippedInvalid > 0;
  return (
    <>
      <p className="drawer-hint">
        Imported {report.importedRows} of {report.totalDataRows} rows{report.fileName ? ` from ${report.fileName}` : ''}.
      </p>
      <ul className="import-summary">
        <li>{report.projectCount} project{report.projectCount === 1 ? '' : 's'}</li>
        <li>{report.disciplineCount} discipline{report.disciplineCount === 1 ? '' : 's'}</li>
        <li>{report.poolCount} role{report.poolCount === 1 ? '' : 's'}</li>
        <li>{report.personCount} people</li>
        <li>{report.assignmentCount} person/project assignment{report.assignmentCount === 1 ? '' : 's'}</li>
        <li>{report.periods.length} month{report.periods.length === 1 ? '' : 's'} covered</li>
      </ul>
      {hasSkips && (
        <div className="import-note">
          Skipped {report.skippedOpen} open (unassigned) request{report.skippedOpen === 1 ? '' : 's'}
          {report.skippedInvalid > 0 ? ` and ${report.skippedInvalid} invalid row${report.skippedInvalid === 1 ? '' : 's'}` : ''}.
        </div>
      )}
      {report.warnings.length > 0 && (
        <ul className="import-warnings">
          {report.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}
      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}
