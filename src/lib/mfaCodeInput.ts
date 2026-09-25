// Formatting for the two-step verification field on the login screen. The one input accepts either
// a 6-digit authenticator code or a backup code, which the server issues as XXXXX-XXXXX (hex,
// upper case) and compares as that exact string (src/lib/mfa.ts). Typing a backup code without
// its hyphen would always fail, so the hyphen is inserted for the user.

export const AUTHENTICATOR_CODE_LENGTH = 6;
export const BACKUP_CODE_LENGTH = 10;

/**
 * Normalises what the user typed or pasted.
 *  - Up to six digits (spaces and hyphens ignored, so "123 456" works) stays an authenticator code.
 *  - Anything longer, or containing letters, is a backup code: upper-cased, non-alphanumerics dropped,
 *    limited to 10 characters, and hyphenated after the fifth.
 */
export function normalizeVerificationCode(raw: string): string {
  const compact = raw.toUpperCase().replace(/[\s-]/g, '');
  if (/^\d{0,6}$/.test(compact)) return compact;
  const alphanumeric = compact.replace(/[^A-Z0-9]/g, '').slice(0, BACKUP_CODE_LENGTH);
  return alphanumeric.length > 5 ? `${alphanumeric.slice(0, 5)}-${alphanumeric.slice(5)}` : alphanumeric;
}

/** True once the value is a full authenticator code or a full backup code. */
export function isCompleteVerificationCode(code: string): boolean {
  return /^\d{6}$/.test(code) || /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code);
}
