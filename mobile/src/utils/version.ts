/**
 * Compares dotted version strings numerically ("1.10.0" > "1.9.0").
 * Returns a negative number, 0 or a positive number like Array.sort.
 * Missing or non-numeric parts count as 0, so "1.2" equals "1.2.0".
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when the running app is older than the backend's minimum supported version. */
export const isBelowMinimum = (current: string, minimum: string): boolean => compareVersions(current, minimum) < 0;
