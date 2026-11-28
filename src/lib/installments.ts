// Instalment-plan rules shared by the browser and the server. Pure: no DB, no DOM.
// All arithmetic is in integer cents so equal splits always add back to the total.

export const MAX_INSTALLMENTS = 36;
export const DEFAULT_INSTALLMENTS = 3;

export interface Installment {
  dueDate: string; // YYYY-MM-DD, UAE calendar day
  amount: number;
}

export type InstallmentStatus = 'paid' | 'partial' | 'overdue' | 'pending';

export interface AllocatedInstallment extends Installment {
  number: number;
  paid: number;
  remaining: number;
  status: InstallmentStatus;
}

export const toCents = (value: unknown) => Math.round((Number(value) || 0) * 100);
const fromCents = (cents: number) => cents / 100;

/** Splits `total` into `count` equal amounts; leftover cents go on the last one. */
export function splitAmounts(total: number, count: number): number[] {
  const n = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(count) || 1));
  const cents = Math.max(0, toCents(total));
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => fromCents(i === n - 1 ? cents - base * (n - 1) : base));
}

/** Same day `months` later, clamped to the month's last day (31 Jan -> 28 Feb). */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function buildEqualPlan(total: number, count: number, firstDue: string): Installment[] {
  return splitAmounts(total, count).map((amount, i) => ({ amount, dueDate: addMonths(firstDue, i) }));
}

/** Re-divides `total` equally over the existing rows, keeping their dates. */
export function resplit(rows: Installment[], total: number): Installment[] {
  const amounts = splitAmounts(total, rows.length);
  return rows.map((row, i) => ({ ...row, amount: amounts[i] }));
}

export const planTotal = (rows: Installment[]) => fromCents(rows.reduce((sum, r) => sum + toCents(r.amount), 0));

const isRealDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Returns the first problem with a plan, or null when it is valid for `total`. */
export function validatePlan(rows: unknown, total: number): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return 'Add at least one instalment.';
  if (rows.length > MAX_INSTALLMENTS) return `A plan can have at most ${MAX_INSTALLMENTS} instalments.`;
  let previous = '';
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as Partial<Installment> | null;
    const dueDate = String(row?.dueDate || '');
    if (!isRealDate(dueDate)) return `Instalment ${i + 1}: choose a due date.`;
    if (!Number.isFinite(Number(row?.amount)) || toCents(row?.amount) <= 0) return `Instalment ${i + 1}: amount must be greater than zero.`;
    if (dueDate < previous) return `Instalment ${i + 1}: due date is earlier than instalment ${i}.`;
    previous = dueDate;
  }
  const difference = toCents(total) - toCents(planTotal(rows as Installment[]));
  if (difference !== 0) {
    return `Instalments are ${fromCents(Math.abs(difference)).toFixed(2)} ${difference > 0 ? 'short of' : 'over'} the balance of ${Number(total).toFixed(2)}.`;
  }
  return null;
}

/**
 * Applies money paid since the plan was saved to the oldest instalments first,
 * then reconciles against the live balance:
 *  - balance higher than what the plan still expects -> `unscheduled`
 *  - balance lower (discount, write-off)            -> later instalments are trimmed
 */
export function allocatePlan(
  rows: Installment[],
  paidSincePlan: number,
  balance: number,
  today: string,
): { installments: AllocatedInstallment[]; unscheduled: number } {
  let credit = Math.max(0, toCents(paidSincePlan));
  const working = rows.map((row, i) => {
    const amount = toCents(row.amount);
    const paid = Math.min(amount, credit);
    credit -= paid;
    return { number: i + 1, dueDate: row.dueDate, amount, paid, remaining: amount - paid };
  });

  const expected = working.reduce((sum, r) => sum + r.remaining, 0);
  const owed = Math.max(0, toCents(balance));
  let excess = expected - owed;
  for (let i = working.length - 1; i >= 0 && excess > 0; i -= 1) {
    const cut = Math.min(working[i].remaining, excess);
    working[i].remaining -= cut;
    excess -= cut;
  }

  return {
    unscheduled: fromCents(Math.max(0, owed - expected)),
    installments: working.map((r) => ({
      number: r.number,
      dueDate: r.dueDate,
      amount: fromCents(r.amount),
      paid: fromCents(r.paid),
      remaining: fromCents(r.remaining),
      status: r.remaining === 0 ? 'paid' : r.dueDate < today ? 'overdue' : r.paid > 0 ? 'partial' : 'pending',
    })),
  };
}

export const formatDueDate = (ymd: string) => (isRealDate(ymd) ? ymd.split('-').reverse().join('/') : ymd);

/** One language-neutral line for the agreement's "subsequent payment(s)" field (printed in English and Arabic). */
export function describePlanForAgreement(rows: Installment[]): string {
  const money = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = rows.map((r, i) => `(${i + 1}) ${money(r.amount)} – ${formatDueDate(r.dueDate)}`);
  return `${money(planTotal(rows))} [${lines.join('; ')}]`;
}
