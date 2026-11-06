import crypto from 'crypto';

/**
 * Timing-safe check of an `Authorization: Bearer <CRON_SECRET>` header.
 * Hashing both sides first gives equal-length buffers, so neither a length
 * mismatch nor an early-exit string comparison leaks anything about the secret.
 */
export function cronSecretMatches(authorizationHeader: string | null | undefined, secret: string): boolean {
  const provided = String(authorizationHeader || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const b = crypto.createHash('sha256').update(secret, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}
