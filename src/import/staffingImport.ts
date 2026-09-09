// Parses a "Staffing_Cinematics_Consolidated" workbook into plan-shaped data. Pure - no DB, no UI.
// Two sheets matter: People (the canonical roster) supplies disciplines/roles/people/team/site;
// Assignments_DB (one row per person/month/project) supplies the assignment facts. Everything else
// in the workbook (README, Project_Legend, Source_Summary, Monthly_View, MTP_Raw, Checks) is either
// documentation or already folded into Assignments_DB, so it isn't read.
//
// This workbook's worksheet .rels reference their Table parts with an absolute Target
// ("/xl/tables/table1.xml") instead of the relative form Excel normally writes
// ("../tables/table1.xml"). exceljs indexes parsed tables by the relative form (xlsx.js), so the
// absolute Target never resolves and exceljs crashes reducing an undefined table entry. Patching
// the two affected .rels files before handing the buffer to exceljs works around it without
// touching exceljs itself.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { comparePeriod } from '../domain/periods';
import { round2 } from '../engine/planning';
import type { ImportReport, NormalizedAssignmentGroup, NormalizedDiscipline, NormalizedImport, NormalizedPerson, NormalizedPool, NormalizedProject } from './rpmImport';
import { parseRpmWorkbook } from './rpmImport';

const POOL_COLOR_PALETTE = [
  '#4f7cff', '#f5a524', '#a855f7', '#22c3aa', '#ec6a9c',
  '#f43f5e', '#0ea5e9', '#84cc16', '#eab308', '#6366f1',
];

const PEOPLE_SHEET = 'People';
const ASSIGNMENTS_SHEET = 'Assignments_DB';

const DISPO_ACTIVITY_TYPES = new Set(['availability', 'available', 'vacation', 'leave']);
const DISPO_PROJECT_NAMES = new Set(['available', 'vacation']);

function isoFirstDayOfPeriod(period: string): string {
  return `${period}-01`;
}

function isoLastDayOfPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${period}-${String(lastDay).padStart(2, '0')}`;
}

/** Rewrites worksheet .rels entries so exceljs can resolve this workbook's Table parts. See header comment. */
async function loadPatchedWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/_rels\/.*\.rels$/.test(name)) continue;
    const text = await zip.files[name].async('string');
    const fixed = text.replace(/Target="\/xl\/tables\//g, 'Target="../tables/');
    if (fixed !== text) zip.file(name, fixed);
  }
  const patched = await zip.generateAsync({ type: 'arraybuffer' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(patched);
  return wb;
}

function isStaffingWorkbook(wb: ExcelJS.Workbook): boolean {
  return wb.getWorksheet(PEOPLE_SHEET) !== undefined && wb.getWorksheet(ASSIGNMENTS_SHEET) !== undefined;
}

function headerMap(sheet: ExcelJS.Worksheet): Map<string, number> {
  const colByHeader = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = String(cell.value ?? '').trim();
    if (text) colByHeader.set(text, colNumber);
  });
  return colByHeader;
}

function cellText(row: ExcelJS.Row, col: number | undefined): string {
  if (col === undefined) return '';
  return String(row.getCell(col).value ?? '').trim();
}

function periodFromMonthCell(row: ExcelJS.Row, col: number): string | null {
  const raw = row.getCell(col).value;
  const date = raw instanceof Date ? raw : typeof raw === 'number' ? new Date(Math.round((raw - 25569) * 86400 * 1000)) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addTo(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

export async function parseStaffingWorkbook(buffer: ArrayBuffer, fileName?: string): Promise<NormalizedImport> {
  const wb = await loadPatchedWorkbook(buffer);

  const peopleSheet = wb.getWorksheet(PEOPLE_SHEET);
  const assignmentsSheet = wb.getWorksheet(ASSIGNMENTS_SHEET);
  if (!peopleSheet || !assignmentsSheet) {
    throw new Error(`This file doesn't look like a Staffing consolidated export — missing the "${PEOPLE_SHEET}" or "${ASSIGNMENTS_SHEET}" sheet.`);
  }

  const peopleCols = headerMap(peopleSheet);
  for (const name of ['Person', 'Job_Title', 'Job_Family', 'Team', 'Site']) {
    if (!peopleCols.has(name)) throw new Error(`This file doesn't look like a Staffing consolidated export — the "${PEOPLE_SHEET}" sheet is missing column ${name}.`);
  }
  const pColPerson = peopleCols.get('Person')!;
  const pColTitle = peopleCols.get('Job_Title')!;
  const pColFamily = peopleCols.get('Job_Family')!;
  const pColTeam = peopleCols.get('Team')!;
  const pColSite = peopleCols.get('Site')!;

  const disciplineOf = new Map<string, string | null>(); // pool name -> discipline name (first seen)
  const personPool = new Map<string, string>(); // person name -> pool name
  const personTeam = new Map<string, string>();
  const personSite = new Map<string, string>();

  for (let r = 2; r <= peopleSheet.rowCount; r += 1) {
    const row = peopleSheet.getRow(r);
    const personName = cellText(row, pColPerson);
    if (!personName) continue;
    const poolName = cellText(row, pColTitle) || 'Unspecified role';
    const disciplineName = cellText(row, pColFamily) || null;
    if (!disciplineOf.has(poolName)) disciplineOf.set(poolName, disciplineName);
    personPool.set(personName, poolName);
    personTeam.set(personName, cellText(row, pColTeam));
    personSite.set(personName, cellText(row, pColSite));
  }

  const aCols = headerMap(assignmentsSheet);
  for (const name of ['Person', 'Job_Title', 'Job_Family', 'Month', 'Project', 'Allocation', 'Activity_Type', 'Review_Flag', 'Confidence']) {
    if (!aCols.has(name)) throw new Error(`This file doesn't look like a Staffing consolidated export — the "${ASSIGNMENTS_SHEET}" sheet is missing column ${name}.`);
  }
  const aColPerson = aCols.get('Person')!;
  const aColTitle = aCols.get('Job_Title')!;
  const aColFamily = aCols.get('Job_Family')!;
  const aColMonth = aCols.get('Month')!;
  const aColProject = aCols.get('Project')!;
  const aColAllocation = aCols.get('Allocation')!;
  const aColActivity = aCols.get('Activity_Type')!;
  const aColReview = aCols.get('Review_Flag')!;
  const aColConfidence = aCols.get('Confidence')!;

  interface Group { personName: string; projectName: string; periods: Map<string, number> }
  const assignmentGroups = new Map<string, Group>();
  const projectTotals = new Map<string, Map<string, number>>();
  const projectIsDispo = new Map<string, boolean>();

  let importedRows = 0;
  let skippedInvalid = 0;
  let reviewFlagged = 0;
  let approximate = 0;
  const unidentifiedProjects = new Map<string, number>();

  const totalDataRows = Math.max(0, assignmentsSheet.rowCount - 1);

  for (let r = 2; r <= assignmentsSheet.rowCount; r += 1) {
    const row = assignmentsSheet.getRow(r);
    const personName = cellText(row, aColPerson);
    const projectName = cellText(row, aColProject);
    const period = periodFromMonthCell(row, aColMonth);
    const fte = Number(row.getCell(aColAllocation).value);

    if (!personName || !projectName || !period || !Number.isFinite(fte) || fte === 0) {
      if (personName || projectName) skippedInvalid += 1;
      continue;
    }

    // Rows for people absent from the People sheet still carry their own role/discipline —
    // register them the same way, so nothing found only in Assignments_DB is silently dropped.
    if (!personPool.has(personName)) {
      const poolName = cellText(row, aColTitle) || 'Unspecified role';
      personPool.set(personName, poolName);
      if (!disciplineOf.has(poolName)) disciplineOf.set(poolName, cellText(row, aColFamily) || null);
    }

    const activityType = cellText(row, aColActivity).toLowerCase();
    const isDispo = DISPO_ACTIVITY_TYPES.has(activityType) || DISPO_PROJECT_NAMES.has(projectName.trim().toLowerCase());
    if (!projectIsDispo.has(projectName)) projectIsDispo.set(projectName, isDispo);

    if (activityType === 'other / review') unidentifiedProjects.set(projectName, (unidentifiedProjects.get(projectName) ?? 0) + 1);
    if (cellText(row, aColReview).toLowerCase() === 'yes') reviewFlagged += 1;
    if (cellText(row, aColConfidence).toLowerCase() === 'approximate') approximate += 1;

    importedRows += 1;
    const groupKey = personName + '::' + projectName;
    let group = assignmentGroups.get(groupKey);
    if (!group) {
      group = { personName, projectName, periods: new Map<string, number>() };
      assignmentGroups.set(groupKey, group);
    }
    const projectPeriods = projectTotals.get(projectName) ?? new Map<string, number>();
    projectTotals.set(projectName, projectPeriods);

    addTo(group.periods, period, fte);
    addTo(projectPeriods, period, fte);
  }

  const disciplineNames = [...new Set([...disciplineOf.values()].filter((n): n is string => n !== null))];
  const disciplines: NormalizedDiscipline[] = disciplineNames.map((name) => ({ name }));

  const pools: NormalizedPool[] = [...disciplineOf.entries()].map(([name, disciplineName], i) => ({
    name,
    disciplineName,
    color: POOL_COLOR_PALETTE[i % POOL_COLOR_PALETTE.length],
  }));

  const people: NormalizedPerson[] = [...personPool.entries()].map(([name, poolName]) => ({
    name,
    poolName,
    team: personTeam.get(name) ?? '',
    site: personSite.get(name) ?? '',
  }));

  const projects: NormalizedProject[] = [...projectTotals.entries()].map(([name, periods]) => {
    const active = [...periods.entries()].filter(([, fte]) => fte > 0.0001).map(([period]) => period).sort(comparePeriod);
    return {
      name,
      startDate: active.length ? isoFirstDayOfPeriod(active[0]) : null,
      endDate: active.length ? isoLastDayOfPeriod(active[active.length - 1]) : null,
      isDispo: projectIsDispo.get(name) ?? false,
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

  const warnings: string[] = [];
  if (reviewFlagged > 0) warnings.push(`${reviewFlagged} row(s) are flagged Review_Flag=Yes — their allocation was imported as-is but may need a closer look.`);
  if (approximate > 0) warnings.push(`${approximate} row(s) have Confidence=Approximate.`);
  if (unidentifiedProjects.size > 0) {
    const names = [...unidentifiedProjects.entries()].map(([name, count]) => `"${name}" (${count})`).join(', ');
    warnings.push(`${[...unidentifiedProjects.values()].reduce((a, b) => a + b, 0)} row(s) have an unidentified/gray project and were imported under their raw name — review recommended: ${names}.`);
  }
  if (skippedInvalid > 0) warnings.push(`${skippedInvalid} row(s) were missing a person, project or valid month/allocation and were skipped.`);

  const periods = [...new Set(assignments.flatMap((g) => g.allocations.map((a) => a.period)))].sort(comparePeriod);

  const report: ImportReport = {
    fileName,
    totalDataRows,
    importedRows,
    skippedOpen: 0,
    skippedInvalid,
    projectCount: projects.length,
    poolCount: pools.length,
    disciplineCount: disciplines.length,
    personCount: people.length,
    assignmentCount: assignments.length,
    periods,
    warnings,
  };

  return { disciplines, pools, people, projects, assignments, report };
}

/** Detects the workbook shape and dispatches to the matching parser. */
export async function parseAnyWorkbook(buffer: ArrayBuffer, fileName?: string): Promise<NormalizedImport> {
  const wb = await loadPatchedWorkbook(buffer);
  if (isStaffingWorkbook(wb)) return parseStaffingWorkbook(buffer, fileName);
  return parseRpmWorkbook(buffer, fileName);
}
