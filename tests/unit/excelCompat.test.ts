import { describe, it, expect } from 'vitest';
import { parseExcelDateCode } from '@/lib/excelCompat';

// Real bulk-upload/import files always carry modern dates (visa expiries,
// lead registration dates) - the reference points below are chosen to cover
// that range plus the well-known Excel 1900-leap-year bug boundary.
describe('parseExcelDateCode', () => {
  it('decodes a known modern serial correctly (2023-01-01 = 44927)', () => {
    expect(parseExcelDateCode(44927)).toEqual({ y: 2023, m: 1, d: 1 });
  });

  it('decodes the serial actually produced by this codebase\'s own exports', () => {
    // Round-trip sanity: a serial written by jsonToSheetBuffer's date
    // handling should decode back to the same modern calendar date.
    expect(parseExcelDateCode(45673)).toEqual({ y: 2025, m: 1, d: 16 });
  });

  it('reproduces Excel\'s fake 1900-02-29 leap day bug (serial 60)', () => {
    // Matches the original xlsx/SSF behavior this replaces - Excel treats
    // 1900 as a leap year, which every implementation must absorb identically
    // or dates before 1900-03-01 come out one day off relative to real Excel.
    expect(parseExcelDateCode(60)).toEqual({ y: 1900, m: 2, d: 28 });
    expect(parseExcelDateCode(61)).toEqual({ y: 1900, m: 3, d: 1 });
  });

  it('returns null for non-finite input', () => {
    expect(parseExcelDateCode(NaN)).toBeNull();
    expect(parseExcelDateCode(Infinity)).toBeNull();
  });
});
