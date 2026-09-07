import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseRpmWorkbook } from '../src/import/rpmImport';

const HEADERS = [
  '', // RPM exports a leading empty column before the data
  '# REQUÊTE',
  'RESSOURCE AFFECTÉE',
  "FAMILLE D'EMPLOIS",
  'UTILISATION (%)',
  'EMPLOI',
  'EMPLOI LOCAL',
  'EMPLOI REPÈRE',
  'TEAMS',
  'DATE DE DÉBUT',
  'DATE DE FIN',
  'PROJET',
  "FONCTION D'EMPLOI",
  'GRADE',
  '# DÉPT DE LA RESSOURCE AFFECTÉE',
  'STATUT',
  '09-2026',
  '10-2026',
  '11-2026',
];

interface RowInput {
  requete: number;
  ressource: string | null;
  famille?: string | null;
  emploiRepere: string | null;
  projet: string | null;
  statut: string;
  months: [number, number, number]; // 09-2026, 10-2026, 11-2026
}

async function buildWorkbook(rows: RowInput[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('data');
  sheet.addRow(HEADERS);
  for (const row of rows) {
    sheet.addRow([
      undefined,
      row.requete,
      row.ressource,
      row.famille ?? 'Animation',
      1,
      'Animateur·trice artistique II',
      '',
      row.emploiRepere,
      'SOLO CAMPAIGN',
      new Date('2026-09-01'),
      new Date('2026-11-30'),
      row.projet,
      'Animation artistique',
      '5',
      'P1-MPR-CIN',
      row.statut,
      row.months[0],
      row.months[1],
      row.months[2],
    ]);
  }
  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

describe('parseRpmWorkbook', () => {
  it('sums multiple rows for the same person/project into one person-assignment', async () => {
    const buffer = await buildWorkbook([
      { requete: 1, ressource: 'Alice', emploiRepere: 'Animateur·trice', projet: 'CINES', statut: 'Assignée', months: [0.5, 0.5, 0] },
      { requete: 2, ressource: 'Alice', emploiRepere: 'Animateur·trice', projet: 'CINES', statut: 'Assignée', months: [0.3, 0, 0] },
      { requete: 3, ressource: 'Bob', emploiRepere: 'Animateur·trice', projet: 'CINES', statut: 'Assignée', months: [1, 1, 1] },
    ]);

    const result = await parseRpmWorkbook(buffer, 'sample.xlsx');

    expect(result.report.importedRows).toBe(3);
    expect(result.report.skippedOpen).toBe(0);
    expect(result.report.skippedInvalid).toBe(0);
    expect(result.report.periods).toEqual(['2026-09', '2026-10', '2026-11']);

    expect(result.projects).toEqual([{ name: 'CINES', startDate: '2026-09-01', endDate: '2026-11-30' }]);

    expect(result.disciplines).toEqual([{ name: 'Animation' }]);
    expect(result.pools).toEqual([{ name: 'Animateur·trice', disciplineName: 'Animation', color: expect.any(String) }]);
    expect(result.people).toEqual(
      expect.arrayContaining([
        { name: 'Alice', poolName: 'Animateur·trice' },
        { name: 'Bob', poolName: 'Animateur·trice' },
      ]),
    );

    const alice = result.assignments.find((a) => a.personName === 'Alice' && a.projectName === 'CINES');
    expect(alice?.allocations).toEqual([
      { period: '2026-09', fte: 0.8 },
      { period: '2026-10', fte: 0.5 },
    ]);

    const bob = result.assignments.find((a) => a.personName === 'Bob' && a.projectName === 'CINES');
    expect(bob?.allocations).toEqual([
      { period: '2026-09', fte: 1 },
      { period: '2026-10', fte: 1 },
      { period: '2026-11', fte: 1 },
    ]);
  });

  it('skips Ouverte (open/unfilled) rows and reports them separately from invalid rows', async () => {
    const buffer = await buildWorkbook([
      { requete: 10, ressource: null, emploiRepere: 'Artiste', projet: 'CINES', statut: 'Ouverte', months: [1, 1, 1] },
      { requete: 11, ressource: 'Cara', emploiRepere: null, projet: 'CINES', statut: 'Assignée', months: [1, 1, 1] },
      { requete: 12, ressource: 'Dan', emploiRepere: 'Artiste', projet: 'CINES', statut: 'Assignée', months: [1, 0, 0] },
    ]);

    const result = await parseRpmWorkbook(buffer);

    expect(result.report.skippedOpen).toBe(1);
    expect(result.report.skippedInvalid).toBe(1);
    expect(result.report.importedRows).toBe(1);
    expect(result.report.warnings).toHaveLength(1);
    expect(result.report.warnings[0]).toContain('missing PROJET, EMPLOI REPÈRE or RESSOURCE AFFECTÉE');

    // Only Dan's row (Artiste) should have produced a pool/person/assignment; the Ouverte and
    // invalid rows contribute nothing.
    expect(result.pools).toEqual([{ name: 'Artiste', disciplineName: 'Animation', color: expect.any(String) }]);
    expect(result.people).toEqual([{ name: 'Dan', poolName: 'Artiste' }]);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].allocations).toEqual([{ period: '2026-09', fte: 1 }]);
  });

  it('derives project date extent from the first/last month with non-zero allocation', async () => {
    const buffer = await buildWorkbook([
      { requete: 20, ressource: 'Eve', emploiRepere: 'Producteur·trice', projet: 'AC INF-NEO', statut: 'Assignée', months: [0, 1, 0.5] },
    ]);

    const result = await parseRpmWorkbook(buffer);
    expect(result.projects).toEqual([{ name: 'AC INF-NEO', startDate: '2026-10-01', endDate: '2026-11-30' }]);
  });

  it('groups roles by their own FAMILLE D\'EMPLOIS, independent from other roles', async () => {
    const buffer = await buildWorkbook([
      { requete: 30, ressource: 'Finn', famille: 'Animation', emploiRepere: 'Animateur·trice technique', projet: 'CINES', statut: 'Assignée', months: [1, 0, 0] },
      { requete: 31, ressource: 'Gaia', famille: 'Effets visuels', emploiRepere: 'Artiste FX', projet: 'CINES', statut: 'Assignée', months: [1, 0, 0] },
    ]);

    const result = await parseRpmWorkbook(buffer);
    expect(result.disciplines).toEqual(
      expect.arrayContaining([{ name: 'Animation' }, { name: 'Effets visuels' }]),
    );
    expect(result.pools).toEqual(
      expect.arrayContaining([
        { name: 'Animateur·trice technique', disciplineName: 'Animation', color: expect.any(String) },
        { name: 'Artiste FX', disciplineName: 'Effets visuels', color: expect.any(String) },
      ]),
    );
  });

  it('rejects a workbook missing the expected RPM columns', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('data');
    sheet.addRow(['Name', 'Value']);
    sheet.addRow(['x', 1]);
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

    await expect(parseRpmWorkbook(buffer)).rejects.toThrow(/RPM export/);
  });
});
