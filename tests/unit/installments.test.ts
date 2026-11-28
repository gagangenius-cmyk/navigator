import { describe, expect, it } from 'vitest';
import { addMonths, allocatePlan, buildEqualPlan, describePlanForAgreement, planTotal, splitAmounts, validatePlan } from '@/lib/installments';

describe('equal split', () => {
  it('adds back to the total, leftover cents on the last row', () => {
    expect(splitAmounts(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(planTotal(buildEqualPlan(15020, 7, '2026-12-01'))).toBe(15020);
  });
  it('steps monthly and clamps to month end', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(buildEqualPlan(30, 3, '2027-01-31').map((r) => r.dueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });
});

describe('validation', () => {
  const rows = [{ dueDate: '2026-12-01', amount: 60 }, { dueDate: '2027-01-01', amount: 40 }];
  it('accepts a plan matching the balance', () => expect(validatePlan(rows, 100)).toBeNull());
  it('rejects wrong totals, bad dates, order and amounts', () => {
    expect(validatePlan(rows, 101)).toMatch(/short/);
    expect(validatePlan(rows, 99)).toMatch(/over/);
    expect(validatePlan([{ dueDate: '2026-02-30', amount: 100 }], 100)).toMatch(/due date/);
    expect(validatePlan([rows[1], rows[0]], 100)).toMatch(/earlier/);
    expect(validatePlan([{ dueDate: '2026-12-01', amount: 0 }], 0)).toMatch(/greater than zero/);
    expect(validatePlan([], 0)).toMatch(/at least one/);
  });
});

describe('allocation', () => {
  const rows = [{ dueDate: '2026-11-01', amount: 100 }, { dueDate: '2026-12-01', amount: 100 }, { dueDate: '2027-01-01', amount: 100 }];
  const today = '2026-11-28';
  it('fills oldest first', () => {
    const { installments, unscheduled } = allocatePlan(rows, 150, 150, today);
    expect(installments.map((r) => [r.paid, r.remaining, r.status])).toEqual([[100, 0, 'paid'], [50, 50, 'partial'], [0, 100, 'pending']]);
    expect(unscheduled).toBe(0);
  });
  it('marks past unpaid rows overdue', () => expect(allocatePlan(rows, 0, 300, today).installments[0].status).toBe('overdue'));
  it('reports money owed beyond the plan (rejected payment)', () => expect(allocatePlan(rows, 0, 350, today).unscheduled).toBe(50));
  it('trims the latest rows when the balance shrinks (discount)', () => {
    expect(allocatePlan(rows, 0, 150, today).installments.map((r) => r.remaining)).toEqual([100, 50, 0]);
  });
});

it('describes the plan for the agreement', () => {
  expect(describePlanForAgreement([{ dueDate: '2026-12-01', amount: 1500 }])).toBe('1,500.00 [(1) 1,500.00 – 01/12/2026]');
});
