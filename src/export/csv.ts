import * as files from '../persistence/files';

function escapeCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','));
  return lines.join('\r\n');
}

/** Quick, single-sheet CSV download — distinct from the full multi-sheet XLSX export used for archiving. */
export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const csv = toCsv(headers, rows);
  const bytes = new TextEncoder().encode(`﻿${csv}`);
  files.downloadBytes(bytes, filename, 'text/csv;charset=utf-8');
}
