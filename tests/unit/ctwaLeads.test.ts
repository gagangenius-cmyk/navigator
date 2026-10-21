import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/sequelize', () => ({ sequelize: {} }));
vi.mock('../../src/lib/webToLeadsIngest', () => ({ ingestWebToLead: vi.fn() }));
vi.mock('../../src/lib/phoneLookup', () => ({ findLeadIdByPhone: vi.fn() }));
vi.mock('../../src/lib/leadRemarks', () => ({ logLeadRemark: vi.fn() }));
vi.mock('../../src/lib/ensureMetaCampaignNameColumn', () => ({ ensureMetaCampaignNameColumn: vi.fn() }));
vi.mock('../../src/lib/meta/graph-api', () => ({ fetchAdDetails: vi.fn() }));

import { extractInboundMessages } from '../../src/lib/whatsappWebhook';
import { residentCountryForPhone } from '../../src/lib/meta/ctwa-leads';

const ctwaPayload = (referral?: unknown) => ({
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      value: {
        contacts: [{ wa_id: '971501234567', profile: { name: 'Asha Rao' } }],
        messages: [{
          id: 'wamid.1',
          from: '971501234567',
          type: 'text',
          text: { body: 'Hi, I want Canada PR details' },
          ...(referral ? { referral } : {}),
        }],
      },
    }],
  }],
});

describe('CTWA referral parsing', () => {
  it('extracts ad attribution and the WhatsApp profile name', () => {
    const [msg] = extractInboundMessages(ctwaPayload({
      source_type: 'ad',
      source_id: '120210000000001',
      source_url: 'https://fb.me/abc',
      ctwa_clid: 'AfX123',
      headline: 'Canada PR 2026',
      body: 'Chat with us',
      media_type: 'image',
      image_url: 'https://img/1.jpg',
    }));
    expect(msg.profileName).toBe('Asha Rao');
    expect(msg.referral).toMatchObject({
      sourceType: 'ad',
      sourceId: '120210000000001',
      ctwaClid: 'AfX123',
      headline: 'Canada PR 2026',
      mediaUrl: 'https://img/1.jpg',
    });
  });

  it('returns no referral for an organic message', () => {
    const [msg] = extractInboundMessages(ctwaPayload());
    expect(msg.referral).toBeNull();
    expect(msg.profileName).toBe('Asha Rao');
  });

  it('ignores a referral with neither an ad id nor a click id', () => {
    const [msg] = extractInboundMessages(ctwaPayload({ headline: 'orphan' }));
    expect(msg.referral).toBeNull();
  });
});

describe('residentCountryForPhone', () => {
  it('maps branch markets by dial code and defaults to UAE', () => {
    expect(residentCountryForPhone('971501234567')).toBe('UAE');
    expect(residentCountryForPhone('97455123456')).toBe('Qatar');
    expect(residentCountryForPhone('96550123456')).toBe('Kuwait');
    expect(residentCountryForPhone('919876543210')).toBe('India');
    expect(residentCountryForPhone('447700900123')).toBe('UAE');
  });
});
