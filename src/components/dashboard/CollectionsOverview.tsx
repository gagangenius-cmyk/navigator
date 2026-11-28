'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDueDate } from '@/lib/installments';

interface Totals {
  currency: string;
  receivedToday: number; receivedMonth: number; receivedMonthVerified: number; receivedMonthPending: number; receivedLastMonth: number;
  dueMonth: number; collectedOfDue: number; outstandingMonth: number; overdue: number; noDate: number;
  projection: Array<{ month: string; amount: number }>;
}

interface Overview {
  scope: 'all' | 'branch' | 'own';
  month: string;
  canViewPnl: boolean;
  totals: Totals[];
  dueList: Array<{ opportunityId: number; leadId: number; client: string; counselor: string | null; currency: string; dueDate: string; remaining: number; installment: string; overdue: boolean }>;
  dueCount: number;
}

interface Pnl { netRevenue: number; totalExpenses: number; netProfit: number; marginPercent: number }

const money = (currency: string, n: number) => `${currency} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function Tile({ label, value, hint, tone = 'text-slate-900' }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 break-words text-xl font-semibold ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function CollectionsOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/collections/overview', { cache: 'no-store' });
      // Roles without any payment permission don't get this section at all.
      if (res.status === 403) { setHidden(true); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load collection figures');
      setData(json);
      if (json.canViewPnl) {
        const pnlRes = await fetch('/api/admin/accounts/pnl', { cache: 'no-store' });
        if (pnlRes.ok) setPnl((await pnlRes.json()).summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collection figures');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (hidden) return null;
  if (error) {
    return (
      <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error} <button type="button" onClick={load} className="ml-2 font-medium underline">Retry</button>
      </div>
    );
  }
  if (!data) return <p className="mt-6 text-sm text-slate-500">Loading collection figures…</p>;

  const title = data.scope === 'own' ? 'My payments' : data.scope === 'branch' ? 'Branch payments' : 'Company payments';
  const empty: Totals = {
    currency: 'AED', receivedToday: 0, receivedMonth: 0, receivedMonthVerified: 0, receivedMonthPending: 0, receivedLastMonth: 0,
    dueMonth: 0, collectedOfDue: 0, outstandingMonth: 0, overdue: 0, noDate: 0, projection: [],
  };
  const groups = data.totals.length ? data.totals : [empty];

  return (
    <section className="mt-6 space-y-4" aria-label={title}>
      <h2 className="text-lg font-semibold text-slate-900">{title} · {monthLabel(data.month)}</h2>

      {/* Currencies are shown separately and never added together. */}
      {groups.map((t) => (
        <div key={t.currency} className="space-y-4">
          {groups.length > 1 && <h3 className="text-sm font-semibold text-slate-700">{t.currency}</h3>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Payment received this month" value={money(t.currency, t.receivedMonth)} tone="text-green-700"
              hint={`Verified ${money(t.currency, t.receivedMonthVerified)} · awaiting Accounts ${money(t.currency, t.receivedMonthPending)}`} />
            <Tile label="Received today" value={money(t.currency, t.receivedToday)} hint={`Last month ${money(t.currency, t.receivedLastMonth)}`} />
            <Tile label="Balance for this month" value={money(t.currency, t.outstandingMonth)} tone="text-amber-700"
              hint={t.noDate > 0 ? `${money(t.currency, t.noDate)} has no due date` : 'Still to collect on dues this month'} />
            <Tile label="Overdue" value={money(t.currency, t.overdue)} tone={t.overdue > 0 ? 'text-red-600' : 'text-slate-900'} hint="Past due date, unpaid" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Payment collection</h3>
              <p className="mt-1 text-xs text-slate-500">Instalments due this month</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">
                {t.dueMonth > 0 ? `${Math.round((t.collectedOfDue / t.dueMonth) * 100)}%` : '—'}
              </p>
              <div className="mt-2 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-[#2a78d6]" style={{ width: `${t.dueMonth > 0 ? Math.min(100, (t.collectedOfDue / t.dueMonth) * 100) : 0}%` }} />
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Due</dt><dd className="font-medium">{money(t.currency, t.dueMonth)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Collected</dt><dd className="font-medium">{money(t.currency, t.collectedOfDue)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Outstanding</dt><dd className="font-medium">{money(t.currency, t.outstandingMonth)}</dd></div>
              </dl>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 xl:col-span-2">
              <h3 className="text-sm font-semibold text-slate-900">Payment projection ({t.currency})</h3>
              <p className="mt-1 text-xs text-slate-500">Expected from unpaid instalments by due month; overdue not included</p>
              <div className="mt-3 h-52">
                {t.projection.every((p) => !p.amount) ? (
                  <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">No instalments due in the next 6 months yet.</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={t.projection.map((p) => ({ name: monthLabel(p.month), amount: p.amount }))} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" fontSize={12} tickLine={false} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => Number(v).toLocaleString('en', { notation: 'compact' })} />
                    <Tooltip formatter={(v) => [money(t.currency, Number(v)), 'Expected']} />
                    <Bar dataKey="amount" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
                )}
              </div>
              <table className="sr-only">
                <caption>Payment projection by month</caption>
                <tbody>{t.projection.map((p) => <tr key={p.month}><th>{monthLabel(p.month)}</th><td>{money(t.currency, p.amount)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </div>
      ))}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Due this month and overdue ({data.dueCount})</h3>
          <Link href="/admin/balance-payments" className="text-sm font-medium text-blue-700 hover:underline">Balance Payments</Link>
        </div>
        {data.dueList.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nothing due.</p>
        ) : (
          <div className="mt-3 max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Due date</th><th className="py-1 pr-3">Client</th>
                  {data.scope !== 'own' && <th className="py-1 pr-3">Counselor</th>}
                  <th className="py-1 pr-3">Instalment</th><th className="py-1 pr-3 text-right">Amount</th><th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {data.dueList.map((r, i) => (
                  <tr key={`${r.opportunityId}-${i}`} className="border-t border-slate-100">
                    <td className={`py-1.5 pr-3 whitespace-nowrap ${r.overdue ? 'font-medium text-red-600' : ''}`}>{formatDueDate(r.dueDate)}{r.overdue ? ' · overdue' : ''}</td>
                    <td className="py-1.5 pr-3">{r.client}</td>
                    {data.scope !== 'own' && <td className="py-1.5 pr-3">{r.counselor || '—'}</td>}
                    <td className="py-1.5 pr-3 whitespace-nowrap">{r.installment}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{money(r.currency, r.remaining)}</td>
                    <td className="py-1.5 text-right">
                      <Link href={`/admin/balance-payments/pay?leadId=${r.leadId}&opportunityId=${r.opportunityId}`} className="font-medium text-blue-700 hover:underline">Collect</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.canViewPnl && pnl && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Profit &amp; Loss this month (CEO only)</h3>
            <Link href="/admin/accounts/pnl" className="text-sm font-medium text-blue-700 hover:underline">Full P&amp;L</Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Net revenue" value={money('AED', pnl.netRevenue)} />
            <Tile label="Expenses" value={money('AED', pnl.totalExpenses)} />
            <Tile label="Net profit" value={money('AED', pnl.netProfit)} tone={pnl.netProfit < 0 ? 'text-red-600' : 'text-green-700'} />
            <Tile label="Margin" value={`${pnl.marginPercent}%`} />
          </div>
        </div>
      )}
    </section>
  );
}
