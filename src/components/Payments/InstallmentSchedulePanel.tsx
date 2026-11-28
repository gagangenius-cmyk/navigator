'use client';

import { useCallback, useEffect, useState } from 'react';
import InstallmentPlanEditor from './InstallmentPlanEditor';
import { formatDueDate, toCents, validatePlan, type AllocatedInstallment, type Installment } from '@/lib/installments';

const STATUS_STYLE: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  partial: 'bg-amber-100 text-amber-800',
  overdue: 'bg-red-100 text-red-800',
  pending: 'bg-gray-100 text-gray-700',
};

interface Props {
  opportunityId: number;
  /** Change this to reload, e.g. after a payment is recorded. */
  refreshKey?: unknown;
  onLoaded?: (installments: AllocatedInstallment[]) => void;
}

/** The saved plan of an existing opportunity: shows paid status and lets it be rescheduled. */
export default function InstallmentSchedulePanel({ opportunityId, refreshKey, onLoaded }: Props) {
  const [data, setData] = useState<{ balance: number; currencyCode: string; canEdit: boolean; unscheduled: number; installments: AllocatedInstallment[] } | null>(null);
  const [draft, setDraft] = useState<Installment[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/payment-schedule`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load the instalment plan');
      setData(json);
      onLoaded?.(json.installments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the instalment plan');
    }
    // onLoaded is a notification only; re-running for a new function identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!data) return <p className={`text-sm ${error ? 'text-red-600' : 'text-gray-500'}`}>{error || 'Loading instalment plan…'}</p>;

  const startEditing = () => {
    // Rescheduling covers what is still owed: paid instalments drop off, the
    // unpaid ones keep their dates and remaining amounts.
    const open = data.installments.filter((r) => r.remaining > 0).map((r) => ({ dueDate: r.dueDate, amount: r.remaining }));
    setDraft(open);
  };

  const save = async () => {
    if (!draft) return;
    const problem = validatePlan(draft, data.balance);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/payment-schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installments: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save the instalment plan');
      setDraft(null);
      window.toast?.success('Instalment plan saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the instalment plan');
    } finally {
      setSaving(false);
    }
  };

  const money = (n: number) => `${data.currencyCode} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  if (draft) {
    return (
      <div className="space-y-3">
        <InstallmentPlanEditor total={data.balance} currency={data.currencyCode} rows={draft} onChange={(rows) => { setError(''); setDraft(rows); }} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setDraft(null); setError(''); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.installments.length === 0 ? (
        <p className="text-sm text-gray-500">No instalment plan yet. Outstanding balance: {money(data.balance)}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr><th className="py-1 pr-3">#</th><th className="py-1 pr-3">Due date</th><th className="py-1 pr-3 text-right">Amount</th><th className="py-1 pr-3 text-right">Remaining</th><th className="py-1">Status</th></tr>
            </thead>
            <tbody>
              {data.installments.map((r) => (
                <tr key={r.number} className="border-t border-gray-100">
                  <td className="py-1.5 pr-3">{r.number}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{formatDueDate(r.dueDate)}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{money(r.amount)}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{money(r.remaining)}</td>
                  <td className="py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.unscheduled > 0 && data.installments.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{money(data.unscheduled)} is not covered by the plan. Reschedule to include it.</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {data.canEdit && toCents(data.balance) > 0 && (
        <button type="button" onClick={startEditing} className="rounded-lg border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50">
          {data.installments.length ? 'Change dates / amounts' : 'Create instalment plan'}
        </button>
      )}
    </div>
  );
}
