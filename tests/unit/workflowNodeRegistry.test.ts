import { describe, expect, it } from 'vitest';
import { getNodeTypeDef, isWebhookHostAllowed, WORKFLOW_NODE_TYPES } from '../../src/lib/workflowNodeRegistry';

describe('workflow node registry', () => {
  it('resolves a known node type and returns undefined for an unknown one', () => {
    expect(getNodeTypeDef('trigger.manual')).toBeDefined();
    expect(getNodeTypeDef('not.a.type')).toBeUndefined();
  });

  it('every node type\'s configSchema.safeParse rejects garbage input rather than throwing', () => {
    for (const def of Object.values(WORKFLOW_NODE_TYPES)) {
      expect(() => def.configSchema.safeParse({ __proto__: 'garbage', random: Symbol('x') })).not.toThrow();
    }
  });

  it('rejects a non-https webhook URL at the schema level', () => {
    const result = WORKFLOW_NODE_TYPES['action.webhook'].configSchema.safeParse({ url: 'http://example.com/hook', method: 'POST' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid https webhook URL at the schema level', () => {
    const result = WORKFLOW_NODE_TYPES['action.webhook'].configSchema.safeParse({ url: 'https://example.com/hook' });
    expect(result.success).toBe(true);
  });
});

describe('isWebhookHostAllowed', () => {
  it('denies every host when no allowlist env var is set (fail closed)', () => {
    const original = process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS;
    delete process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS;
    try {
      expect(isWebhookHostAllowed('https://example.com/hook')).toBe(false);
    } finally {
      if (original !== undefined) process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS = original;
    }
  });

  it('allows only a hostname explicitly present in the allowlist', () => {
    const original = process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS;
    process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS = 'partner.example.com, other.example.com';
    try {
      expect(isWebhookHostAllowed('https://partner.example.com/hook')).toBe(true);
      expect(isWebhookHostAllowed('https://evil.example.com/hook')).toBe(false);
    } finally {
      if (original !== undefined) process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS = original;
      else delete process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS;
    }
  });

  it('rejects a malformed URL rather than throwing', () => {
    process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS = 'example.com';
    expect(isWebhookHostAllowed('not-a-url')).toBe(false);
    delete process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS;
  });
});
