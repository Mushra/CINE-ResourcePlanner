import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import { useStore } from '../../store/useStore';
import { pickContrastingColor } from '../lib/colors';
import { suggestDisciplineMatches, type MppApplyReport, type MppDisciplineResolution } from '../../db/applyMppImport';
import type { NormalizedMppImport } from '../../import/mppImport';

/** Opens scoped to one project — see docs/INTEGRATIONS.md for why a .mpp import may only ever
 * write into the project it targets, never any other. */
export function MppImportDrawer({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const disciplines = useStore((s) => s.data.disciplines);
  const parseMppFile = useStore((s) => s.parseMppFile);
  const applyMppImportToProject = useStore((s) => s.applyMppImportToProject);

  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [normalized, setNormalized] = useState<NormalizedMppImport | null>(null);
  const [choices, setChoices] = useState<Record<string, MppDisciplineResolution>>({});
  const [report, setReport] = useState<MppApplyReport | null>(null);

  async function pickFile(): Promise<void> {
    setBusy(true);
    const result = await parseMppFile();
    setBusy(false);
    if (!result) return;

    const codes = result.normalized.report.disciplineCodes;
    const suggested = suggestDisciplineMatches(codes, disciplines);
    const existingColors = disciplines.map((d) => d.color);
    const initialChoices: Record<string, MppDisciplineResolution> = {};
    for (const code of codes) {
      initialChoices[code] = suggested[code] ?? { kind: 'new', name: code, color: pickContrastingColor(existingColors) };
    }
    setFileName(result.fileName);
    setNormalized(result.normalized);
    setChoices(initialChoices);

    const allAutoMatched = codes.every((code) => suggested[code]);
    if (allAutoMatched) setReport(applyMppImportToProject(projectId, result.normalized, initialChoices));
  }

  function runImport(): void {
    if (!normalized) return;
    setReport(applyMppImportToProject(projectId, normalized, choices));
  }

  const canImport = normalized != null && normalized.report.disciplineCodes.every((code) => {
    const choice = choices[code];
    return choice && (choice.kind === 'existing' || choice.name.trim().length > 0);
  });

  return (
    <Drawer title={`Import .mpp into ${projectName}`} onClose={onClose} width={480}>
      {report ? (
        <MppImportReportView fileName={fileName} report={report} onClose={onClose} />
      ) : normalized ? (
        <DisciplineMappingStep
          fileName={fileName}
          disciplineCodes={normalized.report.disciplineCodes}
          disciplines={disciplines}
          choices={choices}
          onChange={(code, resolution) => setChoices((prev) => ({ ...prev, [code]: resolution }))}
          existingColors={disciplines.map((d) => d.color)}
        >
          <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!canImport} onClick={runImport}>Import</Button>
          </div>
        </DisciplineMappingStep>
      ) : (
        <>
          <p className="drawer-hint">
            Import an MS Project (.mpp) file. Only <strong>{projectName}</strong> will be affected —
            Cinematics, LOQs, dependencies and resource assignments are created or updated under this
            project alone; nothing in any other project is touched.
          </p>
          <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void pickFile()}>
              {busy ? 'Reading file…' : 'Choose file…'}
            </Button>
          </div>
        </>
      )}
    </Drawer>
  );
}

function DisciplineMappingStep({
  fileName, disciplineCodes, disciplines, choices, onChange, existingColors, children,
}: {
  fileName: string | null;
  disciplineCodes: string[];
  disciplines: { id: string; name: string; color: string }[];
  choices: Record<string, MppDisciplineResolution>;
  onChange: (code: string, resolution: MppDisciplineResolution) => void;
  existingColors: string[];
  children: React.ReactNode;
}) {
  return (
    <>
      <p className="drawer-hint">
        {fileName ? `${fileName} — ` : ''}match each discipline code from the file to one of your
        disciplines, or create a new one. Codes already matched by name can still be changed below.
      </p>
      <div className="mpp-mapping-rows">
        {disciplineCodes.map((code) => {
          const choice = choices[code] ?? { kind: 'new' as const, name: code, color: pickContrastingColor(existingColors) };
          return (
            <div key={code} className="mpp-mapping-row">
              <div className="mpp-mapping-code">{code}</div>
              <div className="field">
                <select
                  value={choice.kind === 'existing' ? choice.id : '__new__'}
                  onChange={(e) => {
                    if (e.target.value === '__new__') onChange(code, { kind: 'new', name: code, color: pickContrastingColor(existingColors) });
                    else onChange(code, { kind: 'existing', id: e.target.value });
                  }}
                >
                  <option value="__new__">Create new discipline…</option>
                  {disciplines.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              {choice.kind === 'new' && (
                <div className="field-row">
                  <div className="field">
                    <input
                      value={choice.name}
                      onChange={(e) => onChange(code, { ...choice, name: e.target.value })}
                      placeholder="Discipline name"
                    />
                  </div>
                  <input
                    type="color"
                    value={choice.color}
                    onChange={(e) => onChange(code, { ...choice, color: e.target.value })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {children}
    </>
  );
}

function MppImportReportView({ fileName, report, onClose }: { fileName: string | null; report: MppApplyReport; onClose: () => void }) {
  return (
    <>
      <p className="drawer-hint">Imported{fileName ? ` ${fileName}` : ''}.</p>
      <ul className="import-summary">
        <li>{report.cinematicsCreated} cinematic{report.cinematicsCreated === 1 ? '' : 's'} created, {report.cinematicsMatched} matched</li>
        <li>{report.disciplinesCreated} discipline{report.disciplinesCreated === 1 ? '' : 's'} created</li>
        <li>{report.loqsCreated} LOQ{report.loqsCreated === 1 ? '' : 's'} created, {report.loqsUpdated} updated</li>
        <li>{report.peopleCreated} people created, {report.peopleMatched} matched to existing people</li>
        <li>{report.resourcesLinked} resource assignment{report.resourcesLinked === 1 ? '' : 's'} linked</li>
        <li>{report.dependenciesCreated} dependenc{report.dependenciesCreated === 1 ? 'y' : 'ies'} created</li>
      </ul>
      {report.loqsSkippedOtherProject > 0 && (
        <div className="import-note">
          Skipped {report.loqsSkippedOtherProject} LOQ{report.loqsSkippedOtherProject === 1 ? '' : 's'} already tracked under a different project — left untouched.
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
