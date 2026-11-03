import { describe, it, expect } from 'vitest';
import { campaignMatches, normalizeCampaign } from '@/lib/campaignMatch';

describe('campaignMatches', () => {
  it('ignores case, spacing and separator differences', () => {
    expect(campaignMatches(['norway-uae-saudi'], 'Norway-Uae-Saudi')).toBe(true);
    expect(campaignMatches(['Norway Uae  Saudi'], 'norway_uae-saudi')).toBe(true);
    expect(campaignMatches(['UAE | Skilled'], ' uae skilled ')).toBe(true);
  });

  it('supports * wildcards', () => {
    expect(campaignMatches(['Norway*'], 'Norway-Uae-Saudi')).toBe(true);
    expect(campaignMatches(['*saudi*'], 'Norway-Uae-Saudi form')).toBe(true);
    expect(campaignMatches(['Norway*'], 'Canada-Norway')).toBe(false);
  });

  it('does not match different or empty campaigns', () => {
    expect(campaignMatches(['Norway'], 'Norway-Uae')).toBe(false);
    expect(campaignMatches(['Norway'], '')).toBe(false);
    expect(campaignMatches(['Norway'], null)).toBe(false);
    expect(campaignMatches([''], 'x')).toBe(false);
    expect(campaignMatches(['*'], 'x')).toBe(false);
  });

  it('treats regex characters literally', () => {
    expect(campaignMatches(['UAE (Q4)*'], 'UAE (Q4) leads')).toBe(true);
    expect(campaignMatches(['a.c'], 'abc')).toBe(false);
  });

  it('normalises', () => {
    expect(normalizeCampaign('  A--B__C ')).toBe('a b c');
  });
});
