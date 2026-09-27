export const MIN_PASSWORD_LENGTH = 8;

/** Returns a message for the first problem with a password change, or null when it is acceptable. */
export function validateNewPassword(current: string, next: string, confirm: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (next === current) return 'Choose a password different from your current one.';
  if (next !== confirm) return 'The new passwords do not match.';
  return null;
}
