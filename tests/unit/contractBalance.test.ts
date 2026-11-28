import { describe, expect, it } from 'vitest';
import { balanceAfterEdit } from '@/lib/contractBalance';

// Converted lead: total is already net of the 4,000 discount.
const converted = { total: 22050, discount: 4000, paid: 7030, balance: 15020 };
// "Add Contract": full price, discount comes off the balance.
const direct = { total: 25000, discount: 1250, paid: 4000, balance: 19750 };

describe('balanceAfterEdit', () => {
  it('takes only the payment off, whichever way the total is stored', () => {
    expect(balanceAfterEdit(converted, { ...converted, paid: 8030 })).toBe(14020);
    expect(balanceAfterEdit(direct, { ...direct, paid: 5000 })).toBe(18750);
  });
  it('leaves the balance alone when nothing money-related changed', () => {
    expect(balanceAfterEdit(converted, converted)).toBe(15020);
  });
  it('applies only the difference when a discount changes', () => {
    expect(balanceAfterEdit(converted, { ...converted, discount: 5000 })).toBe(14020);
    expect(balanceAfterEdit(direct, { ...direct, discount: 0 })).toBe(21000);
  });
  it('follows a changed total and never goes negative', () => {
    expect(balanceAfterEdit(converted, { ...converted, total: 23050 })).toBe(16020);
    expect(balanceAfterEdit(converted, { ...converted, paid: 99999 })).toBe(0);
  });
});
