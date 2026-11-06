import { describe, expect, it } from 'vitest';
import { formatDocumentNumber, formatReceiptNumber } from '@/lib/documentNumbering';

const base = { branchName: 'United Arab Emirates', branchAddress: 'Dubai', product: 'CZ Work Permit', sequenceId: 78 };

describe('document numbers use the Dubai day', () => {
  it('21:25Z on 6 Nov is already 7 Nov in Dubai', () => {
    const date = new Date('2026-11-06T21:25:55Z');
    expect(formatDocumentNumber({ prefix: 'AG', ...base, date })).toMatch(/\/07112026\/078$/);
  });

  it('still the same day at 19:59Z (23:59 Dubai)', () => {
    const date = new Date('2026-11-06T19:59:00Z');
    expect(formatDocumentNumber({ prefix: 'AG', ...base, date })).toMatch(/\/06112026\/078$/);
  });

  it('receipt month rolls over with the Dubai day (30 Nov 21:00Z -> 1 Dec)', () => {
    const date = new Date('2026-11-30T21:00:00Z');
    expect(formatReceiptNumber({ branchName: 'United Arab Emirates', branchAddress: 'Dubai', date, sequenceId: 61 })).toMatch(/-202612-061$/);
  });
});
