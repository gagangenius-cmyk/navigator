import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/sequelize', () => ({ sequelize: { query: (...args: unknown[]) => query(...args) } }));

import { syncLeadAppointment, syncLeadFollowup } from '@/lib/leadSchedule';

const updates = () => query.mock.calls.filter(([sql]) => String(sql).trim().startsWith('UPDATE'));

describe('syncLeadFollowup', () => {
  beforeEach(() => query.mockReset());

  it('points the lead at its earliest open reminder and marks it pending', async () => {
    query.mockResolvedValueOnce([{ reminder_date: '2026-11-09 12:30:00' }]).mockResolvedValue([]);
    await syncLeadFollowup(7);
    const [sql, opts] = updates()[0];
    expect(String(sql)).toContain('followupstat = 0');
    expect(opts.replacements).toMatchObject({ d: '2026-11-09', t: '12:30:00', id: 7 });
  });

  it('flips followupstat to 1 when no reminder is open (rescheduled counts as open)', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValue([]);
    await syncLeadFollowup(7);
    expect(query.mock.calls[0][1].replacements.open).toEqual(['pending', 'rescheduled']);
    const [sql] = updates()[0];
    expect(String(sql)).toContain('followupstat = 1');
  });

  it('ignores invalid lead ids and never queries', async () => {
    await syncLeadFollowup(null);
    await syncLeadFollowup(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('syncLeadAppointment', () => {
  beforeEach(() => query.mockReset());

  it('uses the earliest upcoming booking', async () => {
    query.mockResolvedValueOnce([{ date: '2026-11-12' }]).mockResolvedValue([]);
    await syncLeadAppointment(5);
    expect(updates()[0][1].replacements).toMatchObject({ date: '2026-11-12', id: 5 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('falls back to the latest live booking, then to NULL', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ date: '2026-10-01' }]).mockResolvedValue([]);
    await syncLeadAppointment(5);
    expect(updates()[0][1].replacements.date).toBe('2026-10-01');

    query.mockReset();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([]);
    await syncLeadAppointment(5);
    expect(updates()[0][1].replacements.date).toBeNull();
  });
});
