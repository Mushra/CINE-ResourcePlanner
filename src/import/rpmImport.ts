// Parses an RPM ("Filtered Requests") production export into plan-shaped data. Pure - no DB, no
// UI. Each row of the export is one named resource on one project/role over a date span; this
// module groups rows into disciplines/roles/people and per-person assignment totals ready for
// applyRpmImport.
import ExcelJS from 'exceljs';
import { comparePeriod } from '../domain/periods';
import { round2 } from '../engine/planning';

const MONTH_HEADER_RE = /^(\d{2})-(\d{4})$/;
const ASSIGNED_STATUS = 'Assignée';
const OPEN_STATUS = 'Ouverte';

const POOL_COLOR_PALETTE = [
  '#4f7cff', '#f5a524', '#a855f7', '#22c3aa', '#ec6a9c',
  '#f43f5e', '#0ea5e9', '#84cc16', '#eab308', '#6366f1',
];

export interface NormalizedDiscipline {
  name: string;
}

export interface NormalizedPool {
  name: string;
  /** Discipline this role is seeded from (FAMILLE D'EMPLOIS), null if the row didn't have one. */
  disciplineName: string | null;
  color: string;
}

export interface NormalizedPerson {
  name: string;
  poolName: string;
  /** Free-text team, when the source provides one (defaults to '' if absent). */
  team?: string;
  /** Free-text studio/location, when the source provides one (defaults to '' if absent). */
  site?: string;
}

export interface NormalizedProject {
  name: string;
  startDate: string | null;
  endDate: string | null;
  /** Marks a bench/availability placeholder project (defaults to false if absent). */
  isDispo?: boolean;
}

export interface NormalizedAssignmentGroup {
  personName: string;
  projectName: string;
  allocations: { period: string; fte: number }[];
}

export interface ImportReport {
  fileName?: string;
  totalDataRows: number;
  importedRows: number;
  skippedOpen: number;
  skippedInvalid: number;
  projectCount: number;
  poolCount: number;
  disciplineCount: number;
  personCount: number;
  assignmentCount: number;
  periods: string[];
  warnings: string[];
}

export interface NormalizedImport {
  disciplines: NormalizedDiscipline[];
  pools: NormalizedPool[];
  people: NormalizedPerson[];
  projects: NormalizedProject[];
  assignments: NormalizedAssignmentGroup[];
  report: ImportReport;
}

const REQUIRED_COLUMNS = ['STATUT', 'PROJET', 'EMPLOI REPÈRE', 'RESSOURCE AFFECTÉE'];

interface AssignmentGroup {
  personName: string;
  projectName: string;
  periods: Map<string, number>;
}

function isoFirstDayOfPeriod(period: string): string {
  return `${period}-01`;
}

function isoLastDayOfPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${period}-${String(lastDay).padStart(2, '0')}`;
}

function addTo(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

export async function parseRpmWorkbook(buffer: ArrayBuffer, fileName?: string): Promise<NormalizedImport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.getWorksheet('data') ?? wb.worksheets[0];
  if (!sheet) throw new Error('The workbook has no worksheets.');

  const headerRow = sheet.getRow(1);
  const colByHeader = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = String(cell.value ?? '').trim();
    if (text) colByHeader.set(text, colNumber);
  });

  for (const name of REQUIRED_COLUMNS) {
    if (!colByHeader.has(name)) {
      throw new Error('This file does not look like an RPM export - missing column ' + name);
    }
  }

  const monthColumns: { colNumber: number; period: string }[] = [];
  for (const [header, colNumber] of colByHeader) {
    const match = MONTH_HEADER_RE.exec(header);
    if (match) monthColumns.push({ colNumber, period: `${match[2]}-${match[1]}` });
  }
  monthColumns.sort((a, b) => comparePeriod(a.period, b.period));

  const colStatut = colByHeader.get('STATUT')!;
  const colProjet = colByHeader.get('PROJET')!;
  const colRepere = colByHeader.get('EMPLOI REPÈRE')!;
  const colRessource = colByHeader.get('RESSOURCE AFFECTÉE')!;
  const colFamille = colByHeader.get("FAMILLE D'EMPLOIS");

  // Grouped by person+project for the assignment totals. Names can contain spaces, so each group
  // keeps its own name fields rather than being decoded back out of a map key.
  const assignmentGroups = new Map<string, AssignmentGroup>();
  const projectTotals = new Map<string, Map<string, number>>();
  const poolByName = new Map<string, string | null>(); // pool name -> discipline name (first seen)
  const personPool = new Map<string, string>(); // person name -> pool name (first seen)

  let importedRows = 0;
  let skippedOpen = 0;
  let skippedInvalid = 0;
  const warnings: string[] = [];

  const totalDataRows = Math.max(0, sheet.rowCount - 1);

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const statut = String(row.getCell(colStatut).value ?? '').trim();

    if (statut !== ASSIGNED_STATUS) {
      if (statut === OPEN_STATUS) {
        skippedOpen += 1;
      } else {
        skippedInvalid += 1;
        warnings.push(`Row ${r}: unrecognized STATUT "${statut || '(empty)'}", skipped.`);
      }
      continue;
    }

    const projectName = String(row.getCell(colProjet).value ?? '').trim();
    const poolName = String(row.getCell(colRepere).value ?? '').trim();
    const personName = String(row.getCell(colRessource).value ?? '').trim();
    if (!projectName || !poolName || !personName) {
      skippedInvalid += 1;
      warnings.push(`Row ${r}: missing PROJET, EMPLOI REPÈRE or RESSOURCE AFFECTÉE, skipped.`);
      continue;
    }

    const disciplineName = colFamille !== undefined ? String(row.getCell(colFamille).value ?? '').trim() || null : null;
    if (!poolByName.has(poolName)) poolByName.set(poolName, disciplineName);
    if (!personPool.has(personName)) personPool.set(personName, poolName);

    importedRows += 1;
    const groupKey = personName + '::' + projectName;
    let group = assignmentGroups.get(groupKey);
    if (!group) {
      group = { personName, projectName, periods: new Map<string, number>() };
      assignmentGroups.set(groupKey, group);
    }
    const projectPeriods = projectTotals.get(projectName) ?? new Map<string, number>();
    projectTotals.set(projectName, projectPeriods);

    for (const { colNumber, period } of monthColumns) {
      const raw = row.getCell(colNumber).value;
      const fte = typeof raw === 'number' ? raw : 0;
      if (fte === 0) continue;
      addTo(group.periods, period, fte);
      addTo(projectPeriods, period, fte);
    }
  }

  const disciplineNames = [...new Set([...poolByName.values()].filter((n): n is string => n !== null))];
  const disciplines: NormalizedDiscipline[] = disciplineNames.map((name) => ({ name }));

  const pools: NormalizedPool[] = [...poolByName.entries()].map(([name, disciplineName], i) => ({
    name,
    disciplineName,
    color: POOL_COLOR_PALETTE[i % POOL_COLOR_PALETTE.length],
  }));

  const people: NormalizedPerson[] = [...personPool.entries()].map(([name, poolName]) => ({ name, poolName }));

  const projects: NormalizedProject[] = [...projectTotals.entries()].map(([name, periods]) => {
    const active = [...periods.entries()].filter(([, fte]) => fte > 0.0001).map(([period]) => period).sort(comparePeriod);
    return {
      name,
      startDate: active.length ? isoFirstDayOfPeriod(active[0]) : null,
      endDate: active.length ? isoLastDayOfPeriod(active[active.length - 1]) : null,
    };
  });

  const assignments: NormalizedAssignmentGroup[] = [...assignmentGroups.values()]
    .map(({ personName, projectName, periods }) => {
      const allocations = [...periods.entries()]
        .filter(([, fte]) => fte > 0.0001)
        .map(([period, fte]) => ({ period, fte: round2(fte) }))
        .sort((a, b) => comparePeriod(a.period, b.period));
      return { personName, projectName, allocations };
    })
    .filter((group) => group.allocations.length > 0);

  const report: ImportReport = {
    fileName,
    totalDataRows,
    importedRows,
    skippedOpen,
    skippedInvalid,
    projectCount: projects.length,
    poolCount: pools.length,
    disciplineCount: disciplines.length,
    personCount: people.length,
    assignmentCount: assignments.length,
    periods: monthColumns.map((c) => c.period),
    warnings,
  };

  return { disciplines, pools, people, projects, assignments, report };
}
