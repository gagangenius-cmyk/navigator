import { describe, expect, it } from 'vitest';
import { pickNextCandidate, pickSmoothWeighted } from '../../src/lib/roundRobinSelection';

const candidates = [{ id: 12 }, { id: 7 }, { id: 19 }];

describe('round-robin selection', () => {
  it('cycles in queue order and wraps after the final member', () => {
    expect(pickNextCandidate(candidates, null).id).toBe(12);
    expect(pickNextCandidate(candidates, 12).id).toBe(7);
    expect(pickNextCandidate(candidates, 7).id).toBe(19);
    expect(pickNextCandidate(candidates, 19).id).toBe(12);
  });

  it('starts at the first member when the old cursor is no longer eligible', () => {
    expect(pickNextCandidate(candidates, 999).id).toBe(12);
  });

  it('continues an equal-weight queue from a legacy cursor with no SWRR counters', () => {
    let state: Record<number, number> = {};
    const first = pickSmoothWeighted(candidates, () => 1, state, 7);
    expect(first.selected.id).toBe(19);

    state = first.nextCurrent;
    const second = pickSmoothWeighted(candidates, () => 1, state, 19);
    expect(second.selected.id).toBe(12);
  });

  it('honors smooth weights without clumping the heavier member', () => {
    const weights: Record<number, number> = { 12: 1, 7: 2, 19: 1 };
    let state: Record<number, number> = {};
    const picks: number[] = [];

    for (let turn = 0; turn < 8; turn++) {
      const result = pickSmoothWeighted(candidates, (candidate) => weights[candidate.id], state);
      picks.push(result.selected.id);
      state = result.nextCurrent;
    }

    expect(picks).toEqual([7, 12, 19, 7, 7, 12, 19, 7]);
    expect(picks.filter((id) => id === 7)).toHaveLength(4);
  });

  it('does not mutate persisted counters while calculating the next pick', () => {
    const state = { 12: -1, 7: 2, 19: -1 };
    pickSmoothWeighted(candidates, () => 1, state);
    expect(state).toEqual({ 12: -1, 7: 2, 19: -1 });
  });
});
