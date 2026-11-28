'use client';

import { useEffect } from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  DEFAULT_INSTALLMENTS, MAX_INSTALLMENTS, addMonths, buildEqualPlan, planTotal, resplit, toCents, validatePlan,
  type Installment,
} from '@/lib/installments';
import { localToday } from '@/lib/dubaiDate';

interface Props {
  total: number;
  currency: string;
  rows: Installment[];
  onChange: (rows: Installment[]) => void;
  disabled?: boolean;
}

/** Controlled instalment editor: add/remove, equal split, per-row date and amount. */
export default function InstallmentPlanEditor({ total, currency, rows, onChange, disabled }: Props) {
  // A new plan starts as equal monthly instalments; when the balance itself
  // changes (e.g. Amount Paid is edited) the amounts are re-divided and the
  // chosen dates kept. Manual amount edits don't change `total`, so they stick.
  useEffect(() => {
    if (disabled || toCents(total) <= 0) return;
    if (!rows.length) onChange(buildEqualPlan(total, DEFAULT_INSTALLMENTS, addMonths(localToday(), 1)));
    else if (toCents(planTotal(rows)) !== toCents(total)) onChange(resplit(rows, total));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  if (toCents(total) <= 0) {
    return <p className="text-sm text-gray-500">No balance left to split into instalments.</p>;
  }

  const setCount = (count: number) => {
    const next = Math.max(1, Math.min(MAX_INSTALLMENTS, count));
    if (next === rows.length) return;
    const dated = rows.slice(0, next);
    while (dated.length < next) {
      const last = dated[dated.length - 1];
      dated.push({ dueDate: addMonths(last?.dueDate || localToday(), 1), amount: 0 });
    }
    onChange(resplit(dated, total));
  };

  const update = (index: number, patch: Partial<Installment>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const problem = rows.length ? validatePlan(rows, total) : null;
  const step = 'flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Number of instalments</span>
        <button type="button" className={step} onClick={() => setCount(rows.length - 1)} disabled={disabled || rows.length <= 1} aria-label="Remove an instalment">
          <Minus size={16} />
        </button>
        <input
          type="number"
          min={1}
          max={MAX_INSTALLMENTS}
          value={rows.length || ''}
          onChange={(e) => e.target.value && setCount(Number(e.target.value))}
          disabled={disabled}
          aria-label="Number of instalments"
          className="h-9 w-16 rounded-lg border border-gray-300 text-center disabled:bg-gray-50"
        />
        <button type="button" className={step} onClick={() => setCount(rows.length + 1)} disabled={disabled || rows.length >= MAX_INSTALLMENTS} aria-label="Add an instalment">
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={() => onChange(resplit(rows, total))}
          disabled={disabled || !rows.length}
          className="ml-auto rounded-lg border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
        >
          Split equally
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[2rem_1fr_1fr] items-center gap-2">
            <span className="text-sm text-gray-500">{i + 1}.</span>
            <input
              type="date"
              value={row.dueDate}
              onChange={(e) => update(i, { dueDate: e.target.value })}
              disabled={disabled}
              aria-label={`Instalment ${i + 1} due date`}
              className="w-full min-w-0 rounded-lg border border-gray-300 p-2 text-sm disabled:bg-gray-50"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={row.amount || ''}
              onChange={(e) => update(i, { amount: Number(e.target.value) || 0 })}
              disabled={disabled}
              aria-label={`Instalment ${i + 1} amount`}
              className="w-full min-w-0 rounded-lg border border-gray-300 p-2 text-right text-sm disabled:bg-gray-50"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-2 text-sm">
        <span className="text-gray-600">Plan total</span>
        <span className={`font-semibold ${problem ? 'text-red-600' : 'text-green-700'}`}>
          {currency} {planTotal(rows).toLocaleString(undefined, { minimumFractionDigits: 2 })} / {Number(total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>
      {problem && !disabled && <p role="alert" className="text-sm text-red-600">{problem}</p>}
    </div>
  );
}
