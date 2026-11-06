import { describe, expect, it } from 'vitest';
import { cronSecretMatches } from '@/lib/cronAuth';

describe('cronSecretMatches', () => {
  const secret = 'a-long-random-cron-secret';

  it('accepts the exact Bearer secret (case-insensitive scheme)', () => {
    expect(cronSecretMatches(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronSecretMatches(`bearer ${secret}`, secret)).toBe(true);
  });

  it('rejects wrong, prefix, longer, empty and missing values', () => {
    expect(cronSecretMatches('Bearer wrong', secret)).toBe(false);
    expect(cronSecretMatches(`Bearer ${secret.slice(0, -1)}`, secret)).toBe(false);
    expect(cronSecretMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronSecretMatches('Bearer ', secret)).toBe(false);
    expect(cronSecretMatches(null, secret)).toBe(false);
    expect(cronSecretMatches(undefined, secret)).toBe(false);
  });
});
