import ExcelJS from 'exceljs';

// Replaces the `xlsx` (SheetJS) package, which has two unpatched advisories
// with no upstream fix (prototype pollution + ReDoS - see
// https://github.com/advisories/GHSA-4r6h-8v6p-xvw6 and
// https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) and, unlike most of this
// app's other dependencies, is fed *untrusted* input directly: the leads and
// employees bulk-upload endpoints parse whatever .xlsx file a staff member
// uploads. These three functions replicate just the specific xlsx.utils
// surface this codebase actually used (sheet_to_json/json_to_sheet/write/
// SSF.parse_date_code), so the ~5 call sites needed minimal changes beyond
// swapping the underlying library.

export async function readWorkbookFromBase64(base64: string): Promise<ExcelJS.Workbook> {
  const buffer = Buffer.from(base64, 'base64');
  const workbook = new ExcelJS.Workbook();
  // exceljs's own index.d.ts declares `interface Buffer extends ArrayBuffer {}`
  // at module scope, which merges into (and corrupts) the ambient Node Buffer
  // type wherever it's in scope - the merged type demands ArrayBuffer-only
  // members (maxByteLength, resizable, ...) that no real Buffer instance has,
  // and even `as unknown as Buffer` re-resolves to that same corrupted shape
  // in this file. This is an upstream exceljs types bug, not a real
  // type-safety gap - `any` is the only cast that reliably escapes it.
  await workbook.xlsx.load(buffer as any);
  return workbook;
}

// Mirrors XLSX.utils.sheet_to_json(worksheet, { defval }): row 1 is headers,
// every subsequent row becomes an object keyed by header. Rows with no
// populated cells at all are skipped (matches this app's actual import use
// case - a trailing blank Excel row should never become a blank lead/employee
// record, even if real xlsx's own edge-case behavior differs here).
export function sheetToJson<T extends Record<string, unknown>>(
  worksheet: ExcelJS.Worksheet,
  options?: { defval?: unknown }
): T[] {
  const defval = options?.defval;
  const headerRow = worksheet.getRow(1);
  const colCount = Math.max(worksheet.columnCount || 0, headerRow.cellCount || 0);
  const headers: string[] = [];
  for (let col = 1; col <= colCount; col += 1) {
    const value = headerRow.getCell(col).value;
    headers[col] = value !== null && value !== undefined ? String(unwrapCellValue(value)).trim() : '';
  }

  const rows: T[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    let hasValue = false;
    for (let col = 1; col <= colCount; col += 1) {
      const header = headers[col];
      if (!header) continue;
      const raw = unwrapCellValue(row.getCell(col).value);
      if (raw !== null && raw !== undefined && raw !== '') hasValue = true;
      obj[header] = raw === null || raw === undefined ? defval : raw;
    }
    if (hasValue) rows.push(obj as T);
  });
  return rows;
}

// ExcelJS wraps formula results ({ formula, result }) and rich text
// ({ richText: [...] }) in objects instead of returning a plain scalar the
// way xlsx's sheet_to_json always did - unwrap both back to a plain value.
// Dates and plain numbers/strings pass through untouched.
function unwrapCellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return (value as { result: unknown }).result;
    if ('richText' in value) {
      return (value as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
    }
    if ('text' in value) return (value as { text: unknown }).text;
  }
  return value;
}

// Mirrors XLSX.utils.json_to_sheet + book_new + book_append_sheet +
// XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) combined - every call
// site in this codebase always used that exact sequence together, so this
// collapses it into one call. Column set is the union of every row's own
// keys (matches json_to_sheet, which doesn't assume all rows share the same shape).
// Returns Uint8Array rather than Buffer: every call site here feeds straight
// into `new NextResponse(buffer, ...)`, and Node's Buffer<T> generic no
// longer structurally satisfies DOM's BodyInit under this project's current
// @types/node (a well-known Buffer/BodyInit friction point, independent of
// the exceljs-specific Buffer typing bug noted in readWorkbookFromBase64
// above). Uint8Array is unambiguous BodyInit and a Buffer *is* a Uint8Array
// at runtime, so this loses nothing.
export async function jsonToSheetBuffer(rows: Record<string, unknown>[], sheetName: string): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  const headerSet = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => headerSet.add(key)));
  const headers = Array.from(headerSet);
  worksheet.columns = headers.map((header) => ({ header, key: header }));
  rows.forEach((row) => worksheet.addRow(row));

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

// Mirrors XLSX.SSF.parse_date_code(serial) for the {y, m, d} fields this
// codebase's own excelDate() helpers actually read - a fallback path for
// numeric cells that aren't a recognized date format (cellDates-equivalent
// behavior in ExcelJS already returns a real Date for properly-formatted
// date cells; this only covers the "just a number" case).
//
// Standard Excel serial-date algorithm: serial 1 = 1900-01-01, but Excel
// incorrectly treats 1900 as a leap year (a deliberate Lotus 1-2-3
// compatibility bug carried forward ever since), which every implementation
// - including the original xlsx/SSF - absorbs by anchoring the epoch at
// 1899-12-30 instead of 1899-12-31. 25569 is the well-established constant
// for "Excel serial number of the Unix epoch (1970-01-01)" under this scheme.
export function parseExcelDateCode(serial: number): { y: number; m: number; d: number } | null {
  if (!Number.isFinite(serial)) return null;
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}
