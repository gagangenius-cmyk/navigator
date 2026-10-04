export interface RoundRobinCandidate {
  id: number;
}

export function pickNextCandidate<T extends RoundRobinCandidate>(
  candidates: T[],
  lastEmployeeId: number | null
): T {
  if (candidates.length === 0) throw new Error('Cannot pick from an empty round-robin queue');

  const lastIndex = lastEmployeeId === null
    ? -1
    : candidates.findIndex((candidate) => candidate.id === lastEmployeeId);
  return candidates[(lastIndex + 1) % candidates.length];
}

export function pickSmoothWeighted<T extends RoundRobinCandidate>(
  candidates: T[],
  weightOf: (candidate: T) => number,
  priorCurrent: Record<number, number>,
  lastEmployeeId: number | null = null
): { selected: T; nextCurrent: Record<number, number> } {
  if (candidates.length === 0) throw new Error('Cannot pick from an empty round-robin queue');

  const weights = candidates.map((candidate) => Math.max(1, Math.round(weightOf(candidate)) || 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const current = candidates.map((candidate) => priorCurrent[candidate.id] ?? 0);

  // State rows created before smooth weighting have a legacy cursor but no
  // counters. Begin tie-breaking after that cursor so an equal-weight queue
  // continues from its real next member rather than restarting at index zero.
  const hasPersistedCurrent = candidates.some((candidate) => Object.hasOwn(priorCurrent, candidate.id));
  const lastIndex = lastEmployeeId === null
    ? -1
    : candidates.findIndex((candidate) => candidate.id === lastEmployeeId);
  const scanStart = !hasPersistedCurrent && lastIndex >= 0
    ? (lastIndex + 1) % candidates.length
    : 0;

  let bestIndex = scanStart;
  let bestScore = -Infinity;
  for (let offset = 0; offset < candidates.length; offset++) {
    const index = (scanStart + offset) % candidates.length;
    current[index] += weights[index];
    if (current[index] > bestScore) {
      bestScore = current[index];
      bestIndex = index;
    }
  }
  current[bestIndex] -= total;

  const nextCurrent: Record<number, number> = {};
  candidates.forEach((candidate, index) => {
    nextCurrent[candidate.id] = current[index];
  });

  return { selected: candidates[bestIndex], nextCurrent };
}
