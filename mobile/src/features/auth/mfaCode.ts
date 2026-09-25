export const AUTHENTICATOR_CODE_LENGTH = 6;
/** Backup codes are issued as XXXXX-XXXXX (hex, upper case) and the server compares the whole string. */
export const BACKUP_CODE_LENGTH = 10;

/** Digits only, at most six: also cleans up a pasted "123 456". */
export function formatAuthenticatorCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, AUTHENTICATOR_CODE_LENGTH);
}

/** Upper-cases, drops anything that is not a letter or digit, and re-inserts the hyphen after five characters. */
export function formatBackupCode(input: string): string {
  const chars = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, BACKUP_CODE_LENGTH);
  return chars.length > 5 ? `${chars.slice(0, 5)}-${chars.slice(5)}` : chars;
}

export function isCompleteAuthenticatorCode(code: string): boolean {
  return code.length === AUTHENTICATOR_CODE_LENGTH && /^\d+$/.test(code);
}

export function isCompleteBackupCode(code: string): boolean {
  return /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code);
}
