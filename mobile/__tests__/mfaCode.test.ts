import {
  formatAuthenticatorCode,
  formatBackupCode,
  isCompleteAuthenticatorCode,
  isCompleteBackupCode,
} from '@/features/auth/mfaCode';

describe('formatAuthenticatorCode', () => {
  it('keeps digits only and caps at six', () => {
    expect(formatAuthenticatorCode('123456')).toBe('123456');
    expect(formatAuthenticatorCode('123 456')).toBe('123456');
    expect(formatAuthenticatorCode('12345678')).toBe('123456');
    expect(formatAuthenticatorCode('ab12')).toBe('12');
  });
});

describe('formatBackupCode', () => {
  it('upper-cases and inserts the hyphen after five characters', () => {
    expect(formatBackupCode('abcde')).toBe('ABCDE');
    expect(formatBackupCode('abcdef')).toBe('ABCDE-F');
    expect(formatBackupCode('abcde12345')).toBe('ABCDE-12345');
  });

  it('accepts a code typed with its hyphen, spaces or extra characters', () => {
    expect(formatBackupCode('abcde-12345')).toBe('ABCDE-12345');
    expect(formatBackupCode('abcde 12345')).toBe('ABCDE-12345');
    expect(formatBackupCode('abcde-1234599')).toBe('ABCDE-12345');
  });

  it('does not leave a dangling hyphen when the user deletes back to five characters', () => {
    expect(formatBackupCode('ABCDE-')).toBe('ABCDE');
  });
});

describe('completeness checks', () => {
  it('needs exactly six digits for an authenticator code', () => {
    expect(isCompleteAuthenticatorCode('123456')).toBe(true);
    expect(isCompleteAuthenticatorCode('12345')).toBe(false);
    expect(isCompleteAuthenticatorCode('12345a')).toBe(false);
  });

  it('needs the full XXXXX-XXXXX shape for a backup code', () => {
    expect(isCompleteBackupCode('ABCDE-12345')).toBe(true);
    expect(isCompleteBackupCode('ABCDE-1234')).toBe(false);
    expect(isCompleteBackupCode('ABCDE12345')).toBe(false);
    expect(isCompleteBackupCode('abcde-12345')).toBe(false);
  });

  it('produces codes the completeness check accepts', () => {
    expect(isCompleteBackupCode(formatBackupCode('9f3a1c07be'))).toBe(true);
  });
});
