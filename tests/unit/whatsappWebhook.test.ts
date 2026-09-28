import { describe, expect, it } from 'vitest';
import { extractInboundMessages, extractStatusChanges, isOptOutMessage } from '../../src/lib/whatsappWebhook';

const statusPayload = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'waba-1',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        statuses: [
          { id: 'wamid.abc', status: 'delivered', recipient_id: '971500000000', timestamp: '123' },
          { id: 'wamid.def', status: 'failed', recipient_id: '971500000001', timestamp: '124', errors: [{ title: 'Invalid number' }] },
          { id: 'wamid.ghi', status: 'not-a-real-status', recipient_id: '971500000002', timestamp: '125' },
        ],
      },
      field: 'messages',
    }],
  }],
};

const inboundTextPayload = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'waba-1',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        messages: [{ id: 'wamid.xyz', from: '971500000000', timestamp: '123', type: 'text', text: { body: 'STOP' } }],
      },
      field: 'messages',
    }],
  }],
};

const inboundButtonReplyPayload = {
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      value: {
        messages: [{
          id: 'wamid.btn',
          from: '971500000000',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Yes please' } },
        }],
      },
    }],
  }],
};

describe('extractStatusChanges', () => {
  it('extracts valid status updates and ignores an unrecognized status value', () => {
    const changes = extractStatusChanges(statusPayload);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({ providerMessageId: 'wamid.abc', status: 'delivered', recipientId: '971500000000', errorMessage: null });
    expect(changes[1].errorMessage).toBe('Invalid number');
  });

  it('returns an empty array for a payload that is not a WhatsApp Business Account webhook', () => {
    expect(extractStatusChanges({ object: 'page' })).toEqual([]);
  });

  it('never throws on malformed/missing fields', () => {
    expect(() => extractStatusChanges({})).not.toThrow();
    expect(() => extractStatusChanges(null)).not.toThrow();
    expect(() => extractStatusChanges('garbage')).not.toThrow();
    expect(extractStatusChanges(undefined)).toEqual([]);
  });
});

describe('extractInboundMessages', () => {
  it('extracts a plain text message', () => {
    const messages = extractInboundMessages(inboundTextPayload);
    expect(messages).toEqual([{ providerMessageId: 'wamid.xyz', from: '971500000000', type: 'text', text: 'STOP' }]);
  });

  it('extracts the selected title from an interactive button_reply message', () => {
    const messages = extractInboundMessages(inboundButtonReplyPayload);
    expect(messages[0].text).toBe('Yes please');
  });

  it('never throws on malformed input', () => {
    expect(() => extractInboundMessages({})).not.toThrow();
    expect(extractInboundMessages(null)).toEqual([]);
  });
});

describe('isOptOutMessage', () => {
  it('recognizes common opt-out keywords case-insensitively', () => {
    expect(isOptOutMessage('STOP')).toBe(true);
    expect(isOptOutMessage('  stop  ')).toBe(true);
    expect(isOptOutMessage('Unsubscribe')).toBe(true);
  });

  it('does not flag an ordinary reply as opt-out', () => {
    expect(isOptOutMessage('Yes please')).toBe(false);
    expect(isOptOutMessage('stop by tomorrow')).toBe(false);
  });

  it('handles null text', () => {
    expect(isOptOutMessage(null)).toBe(false);
  });
});
