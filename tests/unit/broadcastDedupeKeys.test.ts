import { describe, expect, it } from 'vitest';
import {
  botMessageDedupKey,
  enrollmentPolicyKey,
  outboxDedupeKey,
  recipientIdempotencyKey,
  stepExecutionIdempotencyKey,
  suppressionAddressHash,
  waitEventCorrelationKey,
} from '../../src/lib/broadcastDedupeKeys';

describe('broadcastDedupeKeys', () => {
  it('produces 64-char sha256 hex for every key builder, matching the CHAR(64) columns they populate', () => {
    const keys = [
      suppressionAddressHash('test@example.com'),
      recipientIdempotencyKey(1, 2, 'email'),
      stepExecutionIdempotencyKey(1, 'node-1', 1),
      waitEventCorrelationKey(1, 'lead.replied'),
      enrollmentPolicyKey(1, 2, 'trigger-abc'),
      outboxDedupeKey('broadcast_recipient', 1, 'campaign.send_recipient'),
      botMessageDedupKey(1, 'wamid.abc123'),
      botMessageDedupKey(1, 'node-1', 1),
    ];

    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is deterministic - the same logical inputs always produce the same key, so a sender and a report agree', () => {
    expect(recipientIdempotencyKey(5, 10, 'whatsapp')).toBe(recipientIdempotencyKey(5, 10, 'whatsapp'));
    expect(stepExecutionIdempotencyKey(5, 'send-email', 2)).toBe(stepExecutionIdempotencyKey(5, 'send-email', 2));
  });

  it('is sensitive to every input field, so distinct records never collide', () => {
    expect(recipientIdempotencyKey(5, 10, 'whatsapp')).not.toBe(recipientIdempotencyKey(5, 10, 'sms'));
    expect(recipientIdempotencyKey(5, 10, 'whatsapp')).not.toBe(recipientIdempotencyKey(5, 11, 'whatsapp'));
    expect(stepExecutionIdempotencyKey(5, 'send-email', 1)).not.toBe(stepExecutionIdempotencyKey(5, 'send-email', 2));
  });

  it('normalizes address case/whitespace before hashing, so the same suppressed address always matches', () => {
    expect(suppressionAddressHash('Test@Example.com')).toBe(suppressionAddressHash('  test@example.com  '));
  });

  it('keeps a null lead_id distinct from any real lead id', () => {
    expect(recipientIdempotencyKey(1, null, 'email')).not.toBe(recipientIdempotencyKey(1, 0, 'email'));
  });

  it('distinguishes an inbound dedup key (providerMessageId only) from an outbound one at the same node/attempt', () => {
    expect(botMessageDedupKey(1, 'node-1')).not.toBe(botMessageDedupKey(1, 'node-1', 0));
  });
});
