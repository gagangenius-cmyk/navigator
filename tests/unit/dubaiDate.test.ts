import { afterEach, describe, expect, it, vi } from 'vitest';
import { dubaiToday } from '@/lib/dubaiDate';

describe('dubaiToday', () => {
  afterEach(() => vi.useRealTimers());

  it('rolls to the next Dubai day at 20:00 UTC (00:00 Dubai)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T20:30:00Z'));
    expect(dubaiToday()).toBe('2026-11-07');
  });

  it('still returns the same day at 19:59 UTC (23:59 Dubai)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T19:59:00Z'));
    expect(dubaiToday()).toBe('2026-11-06');
  });

  it('supports a day offset', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'));
    expect(dubaiToday(-1)).toBe('2026-11-05');
  });
});

import { parseCrmDateTime } from '@/lib/dubaiDate';

describe('parseCrmDateTime', () => {
  it('keeps wall-clock text from the web as-is', () => {
    expect(parseCrmDateTime('2026-11-09T12:00:00').toISOString()).toBe('2026-11-09T12:00:00.000Z');
  });

  it('shifts a real instant (mobile toISOString) to Dubai wall-clock', () => {
    // 22:00 Dubai == 18:00Z -> stored as 22:00
    expect(parseCrmDateTime('2026-11-09T18:00:00.000Z').toISOString()).toBe('2026-11-09T22:00:00.000Z');
    // 02:00 Dubai on the 10th == 22:00Z on the 9th -> must land on the 10th, not the 9th
    expect(parseCrmDateTime('2026-11-09T22:00:00.000Z').toISOString()).toBe('2026-11-10T02:00:00.000Z');
    expect(parseCrmDateTime('2026-11-09T12:00:00+04:00').toISOString()).toBe('2026-11-09T12:00:00.000Z');
  });

  it('leaves date-only values and Dates alone', () => {
    expect(parseCrmDateTime('2026-11-09').toISOString()).toBe('2026-11-09T00:00:00.000Z');
    const d = new Date('2026-11-09T05:00:00Z');
    expect(parseCrmDateTime(d)).toBe(d);
  });
});

import { dubaiDayOfUtc, dubaiDayRangeUtc } from '@/lib/dubaiDate';

describe('dubaiDayRangeUtc / dubaiDayOfUtc', () => {
  it('one Dubai day is 20:00Z the day before to 20:00Z', () => {
    expect(dubaiDayRangeUtc('2026-11-07', 1)).toEqual({ startUtc: '2026-11-06 20:00:00', endUtc: '2026-11-07 20:00:00', dates: ['2026-11-07'] });
  });
  it('a week ends on the given day and lists every date', () => {
    const r = dubaiDayRangeUtc('2026-11-07', 7);
    expect(r.startUtc).toBe('2026-11-00 20:00:00'.replace('2026-11-00', '2026-10-31'));
    expect(r.dates[0]).toBe('2026-11-01');
    expect(r.dates).toHaveLength(7);
  });
  it('maps UTC timestamps to the Dubai day', () => {
    expect(dubaiDayOfUtc('2026-11-06 20:30:00')).toBe('2026-11-07');
    expect(dubaiDayOfUtc('2026-11-06 19:59:59')).toBe('2026-11-06');
  });
});

import { parseUtcTimestamp } from '@/lib/dubaiDate';

describe('parseUtcTimestamp', () => {
  it('reads zone-less server timestamps as UTC', () => {
    expect(parseUtcTimestamp('2026-11-07 09:50:00').toISOString()).toBe('2026-11-07T09:50:00.000Z');
    expect(parseUtcTimestamp('2026-11-07T09:50:00').toISOString()).toBe('2026-11-07T09:50:00.000Z');
  });
  it('leaves zoned values and Dates alone, and gives an invalid Date for empty', () => {
    expect(parseUtcTimestamp('2026-11-07T09:50:00.000Z').toISOString()).toBe('2026-11-07T09:50:00.000Z');
    expect(Number.isNaN(parseUtcTimestamp('').getTime())).toBe(true);
    const d = new Date('2026-01-01T00:00:00Z');
    expect(parseUtcTimestamp(d)).toBe(d);
  });
});
