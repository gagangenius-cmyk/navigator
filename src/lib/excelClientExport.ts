// Browser-side counterpart to src/lib/excelCompat.ts (that one's server-only -
// it returns a Node Buffer for an HTTP response body; this returns nothing,
// it triggers a direct file download instead, replacing xlsx's XLSX.writeFile()).
// Same reason for existing: xlsx (SheetJS) has two unpatched advisories with
// no upstream fix.
import ExcelJS from 'exceljs';

// Column set is the union of every row's own keys, matching json_to_sheet's
// behavior (and this module's server-side counterpart) rather than assuming
// every row shares the same shape.
export function addJsonSheet(workbook: ExcelJS.Workbook, rows: Record<string, unknown>[], sheetName: string): void {
  const worksheet = workbook.addWorksheet(sheetName);
  const headerSet = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => headerSet.add(key)));
  const headers = Array.from(headerSet);
  worksheet.columns = headers.map((header) => ({ header, key: header }));
  rows.forEach((row) => worksheet.addRow(row));
}

export async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Convenience for the common single-sheet case (mirrors XLSX.writeFile after
// a single json_to_sheet + book_append_sheet).
export async function downloadJsonAsExcel(rows: Record<string, unknown>[], sheetName: string, filename: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  addJsonSheet(workbook, rows, sheetName);
  await downloadWorkbook(workbook, filename);
}
