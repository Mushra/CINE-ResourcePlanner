import ExcelJS from 'exceljs';
import { PlanningEngine, round2 } from '../engine/planning';
import { getForecastWindowPeriods } from '../engine/forecast';
import { getSanityChecks, type SanityCheck } from '../engine/validation';
import { formatPeriodLabel } from '../domain/periods';
import type { Severity } from '../domain/types';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };

const SEVERITY_FILL: Record<Severity, string> = {
  critical: 'FFFCE4E4',
  warning: 'FFFEF3D6',
  info: 'FFE6F2FF',
};

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle' };
  });
  row.height = 20;
}

function overallStatus(gaps: number[]): { label: string; fill: string } {
  if (gaps.some((g) => g < -0.001)) return { label: 'Understaffed', fill: 'FFFCE4E4' };
  if (gaps.length === 0) return { label: 'No requirements', fill: 'FFF3F4F6' };
  return { label: 'Healthy', fill: 'FFE6F7EE' };
}

export async function buildWorkbook(engine: PlanningEngine): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cinematic Resource Planner';
  wb.created = new Date();

  buildOverviewSheet(wb, engine);
  buildCapacitySheet(wb, engine);
  buildAssignmentsSheet(wb, engine);
  buildSanityChecksSheet(wb, engine);

  return wb;
}

export async function exportWorkbookToBytes(engine: PlanningEngine): Promise<Uint8Array> {
  const wb = await buildWorkbook(engine);
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

function buildOverviewSheet(wb: ExcelJS.Workbook, engine: PlanningEngine): void {
  const pools = engine.pools();
  const sheet = wb.addWorksheet('Portfolio Overview', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Project', key: 'name', width: 26 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Start', key: 'start', width: 14 },
    { header: 'End', key: 'end', width: 14 },
    ...pools.map((p) => ({ header: `${p.name} (req / assn)`, key: `pool_${p.id}`, width: 20 })),
    { header: 'Overall staffing status', key: 'overall', width: 20 },
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columnCount).letter}1` };

  for (const project of engine.projects()) {
    const summary = engine.getProjectStaffingSummary(project.id);
    const row: Record<string, unknown> = {
      name: project.name,
      status: project.status,
      priority: project.priority,
      start: project.startDate ?? 'TBD',
      end: project.endDate ?? 'TBD',
      overall: overallStatus(summary.map((l) => l.gap)).label,
    };
    for (const pool of pools) {
      const line = summary.find((l) => l.poolId === pool.id);
      row[`pool_${pool.id}`] = line ? `${line.required} / ${line.assigned}` : '—';
    }
    const added = sheet.addRow(row);
    added.getCell('overall').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: overallStatus(summary.map((l) => l.gap)).fill } };
  }
}

function buildCapacitySheet(wb: ExcelJS.Workbook, engine: PlanningEngine): void {
  const sheet = wb.addWorksheet('Resource Capacity', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Discipline', key: 'pool', width: 16 },
    { header: 'Month', key: 'month', width: 12 },
    { header: 'Capacity', key: 'capacity', width: 10 },
    { header: 'Required', key: 'required', width: 10 },
    { header: 'Allocated', key: 'allocated', width: 10 },
    { header: 'Available', key: 'available', width: 10 },
    { header: 'Gap', key: 'gap', width: 10 },
    { header: 'Status', key: 'status', width: 16 },
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'H1' };

  const periods = getForecastWindowPeriods(engine, 6);
  for (const pool of engine.pools()) {
    for (const period of periods) {
      const capacity = engine.getCapacity(pool.id, period);
      const required = engine.getRequiredCapacity(pool.id, period);
      const allocated = engine.getAssignedCapacity(pool.id, period);
      const available = round2(capacity - allocated);
      const gap = round2(capacity - required);
      const status = gap < -0.001 ? 'Over capacity' : allocated < required - 0.001 ? 'Understaffed' : 'Healthy';
      const row = sheet.addRow({
        pool: pool.name,
        month: formatPeriodLabel(period),
        capacity,
        required,
        allocated,
        available,
        gap,
        status,
      });
      if (status !== 'Healthy') {
        row.getCell('status').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: status === 'Over capacity' ? 'FFFCE4E4' : 'FFFEF3D6' },
        };
      }
    }
  }
}

function buildAssignmentsSheet(wb: ExcelJS.Workbook, engine: PlanningEngine): void {
  const sheet = wb.addWorksheet('Assignments', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Project', key: 'project', width: 24 },
    { header: 'Discipline', key: 'pool', width: 16 },
    { header: 'Month', key: 'month', width: 12 },
    { header: 'Required FTE', key: 'required', width: 12 },
    { header: 'Assigned FTE', key: 'assigned', width: 12 },
    { header: 'Gap', key: 'gap', width: 10 },
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'F1' };

  for (const project of engine.projects()) {
    for (const period of engine.projectActivePeriods(project.id)) {
      const staffing = engine.getProjectStaffing(project.id, period);
      for (const line of staffing.lines) {
        if (line.required <= 0 && line.assigned <= 0) continue;
        const row = sheet.addRow({
          project: project.name,
          pool: line.poolName,
          month: formatPeriodLabel(period),
          required: line.required,
          assigned: line.assigned,
          gap: line.gap,
        });
        if (line.gap < -0.001) {
          row.getCell('gap').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };
        }
      }
    }
  }
}

function buildSanityChecksSheet(wb: ExcelJS.Workbook, engine: PlanningEngine): void {
  const sheet = wb.addWorksheet('Sanity Checks', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Severity', key: 'severity', width: 12 },
    { header: 'Project', key: 'project', width: 22 },
    { header: 'Discipline', key: 'pool', width: 16 },
    { header: 'Month', key: 'month', width: 12 },
    { header: 'Issue', key: 'issue', width: 42 },
    { header: 'Impact', key: 'impact', width: 52 },
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'F1' };

  const checks: SanityCheck[] = getSanityChecks(engine);
  for (const check of checks) {
    const row = sheet.addRow({
      severity: check.severity.toUpperCase(),
      project: check.projectName ?? '—',
      pool: check.poolName ?? '—',
      month: check.period ? formatPeriodLabel(check.period) : '—',
      issue: check.message,
      impact: check.impact,
    });
    row.getCell('severity').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEVERITY_FILL[check.severity] } };
    row.getCell('severity').font = { bold: true };
  }

  if (checks.length === 0) {
    sheet.addRow({ severity: '—', project: '—', pool: '—', month: '—', issue: 'No issues detected', impact: '' });
  }
}
