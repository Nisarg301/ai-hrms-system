export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Spreadsheet formula injection guard: a cell starting with = + - @ tab or CR
  // would be evaluated by Excel/Sheets, so prefix it to force plain text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** RFC 4180 CSV. The UTF-8 BOM makes Excel show ₹ and non-ASCII names correctly. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return '﻿' + [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
