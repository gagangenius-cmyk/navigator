import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, ingest, findLead, fetchAd } = vi.hoisted(() => ({
  query: vi.fn(),
  ingest: vi.fn(),
  findLead: vi.fn(),
  fetchAd: vi.fn(),
}));

vi.mock('../../src/lib/sequelize', () => ({ sequelize: { query } }));
vi.mock('../../src/lib/webToLeadsIngest', () => ({ ingestWebToLead: ingest }));
vi.mock('../../src/lib/phoneLookup', () => ({ findLeadIdByPhone: findLead }));
vi.mock('../../src/lib/leadRemarks', () => ({ logLeadRemark: vi.fn() }));
vi.mock('../../src/lib/ensureMetaCampaignNameColumn', () => ({ ensureMetaCampaignNameColumn: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/lib/meta/graph-api', () => ({ fetchAdDetails: fetchAd }));

import { retryFailedCtwaLeads } from '../../src/lib/meta/ctwa-leads';

const row = (id: number, status: 'failed' | 'processing' = 'failed') => ({
  id,
  provider_message_id: `wamid.${id}`,
  phone: '971501234567',
  profile_name: 'Asha Rao',
  ctwa_clid: 'AfX',
  source_type: 'ad',
  source_id: '1200',
  source_url: null,
  headline: 'Canada PR',
  ad_body: null,
  media_type: null,
  media_url: null,
  first_message: 'Hi',
  status,
});

/** Routes the mocked sequelize.query by SQL text. */
function mockDb(opts: { enabled?: boolean; rows?: ReturnType<typeof row>[]; claimWins?: boolean }) {
  const updates: string[] = [];
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('CREATE TABLE')) return [];
    if (sql.includes('FROM crm_meta_settings')) return [{ is_enabled: opts.enabled === false ? 0 : 1 }];
    if (sql.includes('SELECT * FROM crm_meta_ctwa_leads')) return opts.rows ?? [];
    if (sql.includes("SET status = 'processing'")) return [{ affectedRows: opts.claimWins === false ? 0 : 1 }];
    if (sql.startsWith('UPDATE crm_meta_ctwa_leads SET')) updates.push(sql);
    return [];
  });
  return updates;
}

describe('retryFailedCtwaLeads', () => {
  beforeEach(() => {
    query.mockReset();
    ingest.mockReset();
    findLead.mockReset();
    fetchAd.mockReset();
    fetchAd.mockResolvedValue(null);
    findLead.mockResolvedValue(null);
  });

  it('does nothing when the integration is disabled', async () => {
    mockDb({ enabled: false, rows: [row(1)] });
    expect(await retryFailedCtwaLeads()).toEqual({ processed: 0, errors: 0 });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('recreates the lead from the stored referral', async () => {
    mockDb({ rows: [row(7)] });
    ingest.mockResolvedValue({ success: true, status: 201, leadId: 55 });
    expect(await retryFailedCtwaLeads()).toEqual({ processed: 1, errors: 0 });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][0]).toMatchObject({ phone: '+971501234567', lastName: 'Asha Rao', LeadSource: 'WhatsApp Ads' });
  });

  it('attributes to an existing lead instead of creating a duplicate', async () => {
    mockDb({ rows: [row(8, 'processing')] });
    findLead.mockResolvedValue(99);
    expect(await retryFailedCtwaLeads()).toEqual({ processed: 1, errors: 0 });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('skips a row another worker already claimed', async () => {
    mockDb({ rows: [row(9)], claimWins: false });
    expect(await retryFailedCtwaLeads()).toEqual({ processed: 0, errors: 0 });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('marks a 4xx rejection as non-retryable and a thrown error as failed', async () => {
    const updates = mockDb({ rows: [row(10), row(11)] });
    ingest
      .mockResolvedValueOnce({ success: false, status: 400, error: 'Missing required lead fields' })
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await retryFailedCtwaLeads()).toEqual({ processed: 0, errors: 2 });
    const params = query.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE crm_meta_ctwa_leads SET status')).map((c) => c[1]?.replacements);
    expect(params.some((p) => p?.status === 'rejected')).toBe(true);
    expect(params.some((p) => p?.status === 'failed' && /ECONNRESET/.test(p.error_message))).toBe(true);
    expect(updates.length).toBeGreaterThan(0);
  });
});
