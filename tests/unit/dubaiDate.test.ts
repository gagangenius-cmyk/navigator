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
