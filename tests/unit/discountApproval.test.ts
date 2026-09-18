import { describe, it, expect } from 'vitest';
import {
  getDiscountTier,
  getDiscountPercentage,
  canApproveDiscountTier,
  DEFAULT_DISCOUNT_TIER_THRESHOLDS,
} from '@/lib/discountApproval';

describe('getDiscountPercentage', () => {
  it('computes the discount as a percentage of the original amount', () => {
    expect(getDiscountPercentage(20, 200)).toBe(10);
  });

  it('returns 0 when the original amount is 0 (avoids divide-by-zero)', () => {
    expect(getDiscountPercentage(20, 0)).toBe(0);
  });
});

describe('getDiscountTier', () => {
  it('is auto-approved at or below the auto threshold', () => {
    expect(getDiscountTier(20, 100)).toBe('auto'); // exactly 20%
    expect(getDiscountTier(10, 100)).toBe('auto');
  });

  it('needs BM/CEO sign-off between the auto and bm/ceo thresholds', () => {
    expect(getDiscountTier(25, 100)).toBe('bm_or_ceo'); // 25%, between 20 and 30
    expect(getDiscountTier(30, 100)).toBe('bm_or_ceo'); // exactly 30%
  });

  it('is ceo-only above the bm/ceo threshold', () => {
    expect(getDiscountTier(50, 100)).toBe('ceo_only');
  });

  it('treats a zero original amount as 0% (auto tier)', () => {
    expect(getDiscountTier(20, 0)).toBe('auto');
  });

  it('respects custom thresholds over the defaults', () => {
    const thresholds = { autoMaxPercent: 5, bmCeoMaxPercent: 15 };
    expect(getDiscountTier(10, 100, thresholds)).toBe('bm_or_ceo');
    expect(getDiscountTier(10, 100, DEFAULT_DISCOUNT_TIER_THRESHOLDS)).toBe('auto');
  });
});

describe('canApproveDiscountTier', () => {
  it('lets anyone approve the auto tier, even with no role at all', () => {
    expect(canApproveDiscountTier('auto', null)).toBe(true);
    expect(canApproveDiscountTier('auto', { roleName: 'Immigration Advisor' })).toBe(true);
  });

  it('requires Branch Manager or CEO for bm_or_ceo and ceo_only tiers', () => {
    expect(canApproveDiscountTier('bm_or_ceo', { roleName: 'Immigration Advisor' })).toBe(false);
    expect(canApproveDiscountTier('bm_or_ceo', { roleName: 'CEO' })).toBe(true);
    expect(canApproveDiscountTier('ceo_only', { roleName: 'Branch Manager' })).toBe(true);
    expect(canApproveDiscountTier('ceo_only', { roleName: 'Immigration Advisor' })).toBe(false);
  });
});
