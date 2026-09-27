import { afterEach, describe, expect, it } from 'vitest';
import {
  decideRefresh,
  generateRefreshToken,
  getMobileAuthConfig,
  hashRefreshToken,
  type MobileAuthConfig,
  type RefreshRowState,
} from '../../src/lib/mobileAuthCore';
import { isValidPushToken, parseEnvironment, parsePlatform } from '../../src/lib/mobileDevicesCore';

const config: MobileAuthConfig = {
  accessTtlSeconds: 3600,
  refreshTtlSeconds: 30 * 86400,
  maxSessionSeconds: 90 * 86400,
  reuseGraceSeconds: 10,
};

const state = (overrides: Partial<RefreshRowState> = {}): RefreshRowState => ({
  revoked: false,
  revokedAgoSeconds: null,
  expired: false,
  familyAgeSeconds: 100,
  ...overrides,
});

describe('refresh token hygiene', () => {
  it('generates unguessable, unique, URL-safe tokens', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it('stores only a stable sha256 hash, never the token', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toContain(token);
    expect(hashRefreshToken(token + 'x')).not.toBe(hash);
  });
});

describe('decideRefresh', () => {
  it('rotates a live token', () => {
    expect(decideRefresh(state(), config)).toBe('ok');
  });

  it('expires a token past its sliding expiry', () => {
    expect(decideRefresh(state({ expired: true }), config)).toBe('expired');
  });

  it('expires the whole session at the absolute cap even if the token itself is fresh', () => {
    expect(decideRefresh(state({ familyAgeSeconds: config.maxSessionSeconds }), config)).toBe('expired');
    expect(decideRefresh(state({ familyAgeSeconds: config.maxSessionSeconds - 1 }), config)).toBe('ok');
  });

  it('treats a just-rotated token as a retry, not theft (grace window)', () => {
    expect(decideRefresh(state({ revoked: true, revokedAgoSeconds: 0 }), config)).toBe('grace');
    expect(decideRefresh(state({ revoked: true, revokedAgoSeconds: 10 }), config)).toBe('grace');
  });

  it('flags replay of an older rotated-out token as reuse (revoke the family)', () => {
    expect(decideRefresh(state({ revoked: true, revokedAgoSeconds: 11 }), config)).toBe('reuse');
    expect(decideRefresh(state({ revoked: true, revokedAgoSeconds: 86400 }), config)).toBe('reuse');
    expect(decideRefresh(state({ revoked: true, revokedAgoSeconds: null }), config)).toBe('reuse');
  });

  it('reuse wins over expiry: a revoked token is never merely "expired"', () => {
    expect(decideRefresh(state({ revoked: true, revokedAgoSeconds: 500, expired: true }), config)).toBe('reuse');
  });
});

describe('getMobileAuthConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults to 1h access, 30d refresh, 90d cap', () => {
    delete process.env.MOBILE_ACCESS_TOKEN_TTL;
    delete process.env.MOBILE_REFRESH_TTL_DAYS;
    delete process.env.MOBILE_SESSION_MAX_DAYS;
    expect(getMobileAuthConfig()).toMatchObject({
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 30 * 86400,
      maxSessionSeconds: 90 * 86400,
    });
  });

  it('honours env overrides but clamps unsafe values', () => {
    process.env.MOBILE_ACCESS_TOKEN_TTL = '900';
    process.env.MOBILE_REFRESH_TTL_DAYS = '7';
    expect(getMobileAuthConfig().accessTtlSeconds).toBe(900);
    expect(getMobileAuthConfig().refreshTtlSeconds).toBe(7 * 86400);

    process.env.MOBILE_ACCESS_TOKEN_TTL = '1';
    expect(getMobileAuthConfig().accessTtlSeconds).toBe(60);
    process.env.MOBILE_ACCESS_TOKEN_TTL = '999999999';
    expect(getMobileAuthConfig().accessTtlSeconds).toBe(86400);
    process.env.MOBILE_ACCESS_TOKEN_TTL = 'nonsense';
    expect(getMobileAuthConfig().accessTtlSeconds).toBe(3600);
  });
});

describe('push token validation', () => {
  const apns = 'a'.repeat(64);
  const fcm = `${'A1b2C3d4E5'.repeat(8)}:APA91b${'x'.repeat(80)}`;

  it('accepts a well-formed token for its own platform', () => {
    expect(isValidPushToken('ios', apns)).toBe(true);
    expect(isValidPushToken('android', fcm)).toBe(true);
  });

  it('rejects a token of the wrong shape for the platform', () => {
    expect(isValidPushToken('android', apns)).toBe(false);
    expect(isValidPushToken('ios', fcm)).toBe(false);
  });

  it('rejects junk, oversized and injection-style values', () => {
    expect(isValidPushToken('ios', '')).toBe(false);
    expect(isValidPushToken('ios', 'zz'.repeat(40))).toBe(false);
    expect(isValidPushToken('android', 'short')).toBe(false);
    expect(isValidPushToken('android', `${fcm}'; DROP TABLE x;--`)).toBe(false);
    expect(isValidPushToken('android', 'x'.repeat(5000))).toBe(false);
  });

  it('parses platform and environment strictly', () => {
    expect(parsePlatform('ios')).toBe('ios');
    expect(parsePlatform('android')).toBe('android');
    expect(parsePlatform('web')).toBeNull();
    expect(parsePlatform(undefined)).toBeNull();
    expect(parseEnvironment('sandbox')).toBe('sandbox');
    expect(parseEnvironment('production')).toBe('production');
    expect(parseEnvironment('staging')).toBeNull();
  });
});
