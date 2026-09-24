import { decisionLabels, MIN_NOTE_LENGTH, requiresNote, validateNote } from '@/features/approvals/decisionRules';

describe('decisionLabels', () => {
  it('words each approval type naturally', () => {
    expect(decisionLabels('discount', 'approve')).toMatchObject({ verb: 'Approve', title: 'Approve discount', done: 'Discount approved' });
    expect(decisionLabels('payment', 'approve')).toMatchObject({ verb: 'Approve', title: 'Approve payment' });
    expect(decisionLabels('compliance', 'approve')).toMatchObject({ verb: 'Sign off', title: 'Sign off agreement', done: 'Agreement signed off' });
  });

  it('words rejections per type', () => {
    expect(decisionLabels('discount', 'reject')).toMatchObject({ verb: 'Reject', title: 'Reject discount', done: 'Discount rejected' });
    expect(decisionLabels('compliance', 'reject')).toMatchObject({ title: 'Reject agreement', done: 'Agreement rejected' });
  });
});

describe('rejection reasons', () => {
  it('requires a reason to reject a payment or an agreement, but nothing else', () => {
    expect(requiresNote('payment', 'reject')).toBe(true);
    expect(requiresNote('compliance', 'reject')).toBe(true);
    expect(requiresNote('payment', 'approve')).toBe(false);
    expect(requiresNote('compliance', 'approve')).toBe(false);
    // The discount endpoint has nowhere to store a reason, so none is demanded.
    expect(requiresNote('discount', 'reject')).toBe(false);
  });

  it('rejects a blank or too-short reason', () => {
    expect(validateNote('payment', 'reject', '')).toMatch(/reason/i);
    expect(validateNote('payment', 'reject', '   ')).toMatch(/reason/i);
    expect(validateNote('compliance', 'reject', 'x'.repeat(MIN_NOTE_LENGTH - 1))).toMatch(/reason/i);
  });

  it('accepts a real reason and never blocks an approval', () => {
    expect(validateNote('payment', 'reject', 'Amount does not match the receipt')).toBeNull();
    expect(validateNote('payment', 'approve', '')).toBeNull();
    expect(validateNote('discount', 'reject', '')).toBeNull();
  });
});
