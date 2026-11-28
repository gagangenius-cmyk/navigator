// Outstanding balances are adjusted by what changed, never recomputed from the total.
//
// Rows hold the total in two different ways: lead conversion stores it with the
// discount already taken off (discount kept for information), while "Add
// Contract" stores the full price and takes the discount off the balance.
// "total - discount - paid" subtracted the discount a second time for the
// former, and "total - paid" would drop it for the latter. A change is correct
// for both.

export interface MoneyColumns {
  total: number;
  discount: number;
  paid: number;
  balance: number;
}

const cents = (n: number) => Math.round((Number(n) || 0) * 100);

/** New balance after total / discount / paid are edited from `before` to `after`. */
export function balanceAfterEdit(before: MoneyColumns, after: Omit<MoneyColumns, 'balance'>): number {
  const next = cents(before.balance)
    + (cents(after.total) - cents(before.total))
    - (cents(after.discount) - cents(before.discount))
    - (cents(after.paid) - cents(before.paid));
  return Math.max(0, next) / 100;
}
