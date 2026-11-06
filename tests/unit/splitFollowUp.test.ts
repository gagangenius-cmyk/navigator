import { describe, expect, it } from 'vitest';
import { splitFollowUp } from '@/lib/dubaiDate';

describe('splitFollowUp', () => {
  it('splits datetime-local and SQL datetimes', () => {
    expect(splitFollowUp('2026-11-09T14:30')).toEqual({ date: '2026-11-09', time: '14:30:00' });
    expect(splitFollowUp('2026-11-09 14:30:15')).toEqual({ date: '2026-11-09', time: '14:30:15' });
  });
  it('uses 09:00 for a bare date and nulls for empty/invalid', () => {
    expect(splitFollowUp('2026-11-09')).toEqual({ date: '2026-11-09', time: '09:00:00' });
    expect(splitFollowUp('')).toEqual({ date: null, time: null });
    expect(splitFollowUp('nope')).toEqual({ date: null, time: null });
  });
});
