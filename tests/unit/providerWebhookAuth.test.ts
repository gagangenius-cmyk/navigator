import { afterEach, describe, expect, it } from 'vitest';
import { validateProviderSecret } from '../../src/lib/meta/webhook';

const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });
const SECRET = 'a-long-shared-secret-123';

describe('validateProviderSecret', () => {
  afterEach(() => { delete process.env.WHATSAPP_PROVIDER_WEBHOOK_SECRET; });

  it('fails closed when no secret is configured', () => {
    expect(validateProviderSecret(headers({ 'x-webhook-secret': SECRET }))).toBe(false);
  });

  it('fails closed when the configured secret is too short', () => {
    process.env.WHATSAPP_PROVIDER_WEBHOOK_SECRET = 'short';
    expect(validateProviderSecret(headers({ 'x-webhook-secret': 'short' }))).toBe(false);
  });

  it('accepts the secret in X-Webhook-Secret', () => {
    process.env.WHATSAPP_PROVIDER_WEBHOOK_SECRET = SECRET;
    expect(validateProviderSecret(headers({ 'x-webhook-secret': SECRET }))).toBe(true);
  });

  it('accepts the secret as a Bearer token', () => {
    process.env.WHATSAPP_PROVIDER_WEBHOOK_SECRET = SECRET;
    expect(validateProviderSecret(headers({ authorization: `Bearer ${SECRET}` }))).toBe(true);
  });

  it('rejects a wrong or missing secret', () => {
    process.env.WHATSAPP_PROVIDER_WEBHOOK_SECRET = SECRET;
    expect(validateProviderSecret(headers({ 'x-webhook-secret': 'wrong-secret-value-xx' }))).toBe(false);
    expect(validateProviderSecret(headers({}))).toBe(false);
  });
});
