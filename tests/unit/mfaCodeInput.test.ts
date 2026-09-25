import { describe, expect, it } from 'vitest';
import { isCompleteVerificationCode, normalizeVerificationCode } from '../../src/lib/mfaCodeInput';

describe('normalizeVerificationCode', () => {
  it('keeps an authenticator code as digits, ignoring spaces and hyphens', () => {
    expect(normalizeVerificationCode('123456')).toBe('123456');
    expect(normalizeVerificationCode('123 456')).toBe('123456');
    expect(normalizeVerificationCode('123-456')).toBe('123456');
    expect(normalizeVerificationCode('12')).toBe('12');
    expect(normalizeVerificationCode('')).toBe('');
  });

  it('upper-cases a backup code and inserts the hyphen the server expects', () => {
    expect(normalizeVerificationCode('abcde')).toBe('ABCDE');
    expect(normalizeVerificationCode('abcdef')).toBe('ABCDE-F');
    expect(normalizeVerificationCode('9f3a1c07be')).toBe('9F3A1-C07BE');
  });

  it('accepts a backup code typed with its hyphen, spaces or stray characters', () => {
    expect(normalizeVerificationCode('abcde-12345')).toBe('ABCDE-12345');
    expect(normalizeVerificationCode('abcde 12345')).toBe('ABCDE-12345');
    expect(normalizeVerificationCode('abcde-12345 extra!')).toBe('ABCDE-12345');
  });

  it('does not leave a dangling hyphen when the user deletes back to five characters', () => {
    expect(normalizeVerificationCode('ABCDE-')).toBe('ABCDE');
  });

  it('treats a purely numeric backup code as a backup code once it is longer than six digits', () => {
    expect(normalizeVerificationCode('1234567')).toBe('12345-67');
    expect(normalizeVerificationCode('1234567890')).toBe('12345-67890');
  });
});

describe('isCompleteVerificationCode', () => {
  it('accepts a full authenticator code or a full backup code only', () => {
    expect(isCompleteVerificationCode('123456')).toBe(true);
    expect(isCompleteVerificationCode('ABCDE-12345')).toBe(true);
    expect(isCompleteVerificationCode('12345')).toBe(false);
    expect(isCompleteVerificationCode('ABCDE')).toBe(false);
    expect(isCompleteVerificationCode('ABCDE-1234')).toBe(false);
    expect(isCompleteVerificationCode('abcde-12345')).toBe(false);
  });

  it('accepts everything normalizeVerificationCode produces from a real backup code', () => {
    expect(isCompleteVerificationCode(normalizeVerificationCode('9f3a1c07be'))).toBe(true);
  });
});
