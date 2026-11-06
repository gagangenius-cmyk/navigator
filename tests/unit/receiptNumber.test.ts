import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/sequelize', () => ({ sequelize: { query: (...args: unknown[]) => query(...args) } }));

import { uniqueReceiptNumber } from '@/lib/receiptNumber';

const branch = { branchName: 'United Arab Emirates', branchAddress: 'Dubai', date: new Date('2026-11-06T21:25:00Z') };

describe('uniqueReceiptNumber', () => {
  beforeEach(() => query.mockReset());

  it('returns the candidate when it is free', async () => {
    query.mockResolvedValueOnce([]);
    expect(await uniqueReceiptNumber(branch, 5)).toBe('RCP-DXB-202611-005');
  });

  it('skips numbers already used by either table', async () => {
    query.mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([{ x: 1 }]).mockResolvedValueOnce([]);
    expect(await uniqueReceiptNumber(branch, 5)).toBe('RCP-DXB-202611-007');
    expect(query.mock.calls[1][1].replacements.n).toBe('RCP-DXB-202611-006');
  });
});
