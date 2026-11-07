'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { dubaiToday } from '@/lib/dubaiDate';

interface DailyWorkData {
  range: { from: string; to: string; days: number };
  totals: { leadsWorked: number; statusChanges: number; remarks: number; followUps: number; appointments: number; whatsapp: number };
  byStatus: Array<{ status: string; leads: number; changes: number }>;
  moves: Array<{ move: string; count: number }>;
  daily: Array<{ date: string; leadsWorked: number; statusChanges: number; remarks: number; followUps: number; appointments: number }>;
  snapshot: Array<{ status: string; count: number }>;
  snapshotTotal: number;
  truncated: boolean;
  statusChanges?: Array<{ date: string; time: string; leadId: number; leadName: string; phone: string; from: string; to: string; currentStatus: string }>;
}

type Period = 'today' | 'yesterday' | '7' | '14' | '30';

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7', label: 'Last 7 days' },
  { id: '14', label: 'Last 14 days' },
  { id: '30', label: 'Last 30 days' },
];

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });

/** "What I did on my leads": per day / period, how many leads were worked and into which status they moved. */
export default function DailyLeadWork({ employeeId, detailed = false }: { employeeId?: number; detailed?: boolean }) {
  const [period, setPeriod] = useState<Period>('today');
  // detailed (the Lead Status report page): also pick any single day, and list every lead that moved.
  const [customDate, setCustomDate] = useState('');
  const [view, setView] = useState<'list' | 'card'>('list');
  const [data, setData] = useState<DailyWorkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const date = customDate || (period === 'yesterday' ? dubaiToday(-1) : dubaiToday());
      const days = customDate || period === 'today' || period === 'yesterday' ? 1 : Number(period);
      const params = new URLSearchParams({ date, days: String(days) });
      if (employeeId) params.set('employeeId', String(employeeId));
      if (detailed) params.set('detail', '1');
      const res = await fetch(`/api/admin/dashboard/daily-work?${params}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Server returned ${res.status}`);
      setData(json.data as DailyWorkData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [period, employeeId, customDate, detailed]);

  useEffect(() => { void load(); }, [load]);

  // The report covers the selected period (Today / Yesterday / week / month); a plain link keeps the auth cookie.
  const exportHref = (format: 'xlsx' | 'csv') => {
    const date = customDate || (period === 'yesterday' ? dubaiToday(-1) : dubaiToday());
    const days = customDate || period === 'today' || period === 'yesterday' ? 1 : Number(period);
    const params = new URLSearchParams({ date, days: String(days), format });
    if (employeeId) params.set('employeeId', String(employeeId));
    return `/api/admin/dashboard/daily-work/export?${params}`;
  };

  const totalMoves = data?.byStatus.reduce((sum, row) => sum + row.leads, 0) || 0;

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Daily lead work</h2>
          <p className="text-xs text-slate-500">
            {data ? `${data.range.from === data.range.to ? dayLabel(data.range.from) : `${dayLabel(data.range.from)} – ${dayLabel(data.range.to)}`} (Dubai time)` : 'What you did on your leads'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setCustomDate(''); setPeriod(p.id); }}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${!customDate && period === p.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {p.label}
            </button>
          ))}
          {detailed && (
            <input
              type="date"
              value={customDate}
              max={dubaiToday()}
              onChange={(e) => setCustomDate(e.target.value)}
              aria-label="Pick a day"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700"
            />
          )}
          <a
            href={exportHref('xlsx')}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            <Download className="h-3.5 w-3.5" /> Excel report
          </a>
          <a
            href={exportHref('csv')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </a>
          <button onClick={() => void load()} aria-label="Refresh daily work" className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Daily work could not be loaded: {error}
        </div>
      )}

      {data && !error && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Tile label="Leads worked" value={data.totals.leadsWorked} />
            <Tile label="Status changes" value={data.totals.statusChanges} />
            <Tile label="Remarks" value={data.totals.remarks} />
            <Tile label="Follow-ups set" value={data.totals.followUps} />
            <Tile label="Appointments booked" value={data.totals.appointments} />
            <Tile label="WhatsApp sent" value={data.totals.whatsapp} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Leads moved into each status</h3>
              {data.byStatus.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No status changes in this period.</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 text-right font-medium">Leads</th>
                      <th className="pb-2 text-right font-medium">Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byStatus.map((row) => (
                      <tr key={row.status} className="border-t border-slate-100">
                        <td className="py-2 text-slate-800">{row.status}</td>
                        <td className="py-2 text-right font-semibold text-slate-900">{row.leads}</td>
                        <td className="py-2 text-right text-slate-500">{row.changes}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-200 font-semibold">
                      <td className="py-2 text-slate-900">Total</td>
                      <td className="py-2 text-right text-slate-900">{totalMoves}</td>
                      <td className="py-2 text-right text-slate-700">{data.totals.statusChanges}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {data.moves.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Most common moves</h3>
                  <ul className="mt-2 space-y-1 text-sm text-slate-700">
                    {data.moves.slice(0, 6).map((m) => (
                      <li key={m.move} className="flex justify-between gap-3"><span className="truncate">{m.move}</span><span className="font-semibold">{m.count}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">My leads right now, by status</h3>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {data.snapshot.map((row) => (
                    <tr key={row.status} className="border-t border-slate-100 first:border-t-0">
                      <td className="py-2 text-slate-800">{row.status}</td>
                      <td className="py-2 text-right font-semibold text-slate-900">{row.count}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 font-semibold">
                    <td className="py-2 text-slate-900">Total assigned leads</td>
                    <td className="py-2 text-right text-slate-900">{data.snapshotTotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {detailed && (
            <div className="mt-6 overflow-x-auto">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Leads whose status I changed</h3>
              {(data.statusChanges || []).length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No status changes in this period.</p>
              ) : (
                <>
                <div className="mt-2 flex gap-1">
                  {(['list', 'card'] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setView(v)} className={`rounded-md border px-3 py-1 text-xs font-medium ${view === v ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600'}`}>{v === 'list' ? 'List' : 'Cards'}</button>
                  ))}
                </div>
                {view === 'card' ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[...(data.statusChanges || [])].reverse().map((c, i) => (
                      <a key={`${c.leadId}-${c.date}-${c.time}-${i}`} href={`/admin/leads/${c.leadId}/edit`} className="rounded-lg border border-slate-200 p-3 hover:border-blue-300">
                        <div className="flex justify-between text-xs text-slate-400"><span>#{c.leadId}</span><span>{c.date} {c.time}</span></div>
                        <div className="mt-1 font-medium text-slate-900">{c.leadName}</div>
                        <div className="text-xs text-slate-500">{c.phone || '—'}</div>
                        <div className="mt-2 text-sm text-slate-600">{c.from} → <span className="font-semibold text-slate-900">{c.to}</span></div>
                        <div className="text-xs text-slate-400">Now: {c.currentStatus || '—'}</div>
                      </a>
                    ))}
                  </div>
                ) : (
                <table className="mt-3 w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="pb-2 font-medium">When (Dubai)</th>
                      <th className="pb-2 font-medium">Lead</th>
                      <th className="pb-2 font-medium">Phone</th>
                      <th className="pb-2 font-medium">From</th>
                      <th className="pb-2 font-medium">To</th>
                      <th className="pb-2 font-medium">Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(data.statusChanges || [])].reverse().map((c, i) => (
                      <tr key={`${c.leadId}-${c.date}-${c.time}-${i}`} className="border-t border-slate-100">
                        <td className="whitespace-nowrap py-2 text-slate-600">{c.date} {c.time}</td>
                        <td className="py-2"><a href={`/admin/leads/${c.leadId}/edit`} className="font-medium text-blue-700 hover:underline">{c.leadName}</a> <span className="text-xs text-slate-400">#{c.leadId}</span></td>
                        <td className="whitespace-nowrap py-2 text-slate-600">{c.phone || '—'}</td>
                        <td className="py-2 text-slate-600">{c.from}</td>
                        <td className="py-2 font-semibold text-slate-900">{c.to}</td>
                        <td className="py-2 text-slate-600">{c.currentStatus || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
                </>
              )}
            </div>
          )}

          {data.daily.length > 1 && (
            <div className="mt-6 overflow-x-auto">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Day by day</h3>
              <table className="mt-3 w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Day</th>
                    <th className="pb-2 text-right font-medium">Leads worked</th>
                    <th className="pb-2 text-right font-medium">Status changes</th>
                    <th className="pb-2 text-right font-medium">Remarks</th>
                    <th className="pb-2 text-right font-medium">Follow-ups</th>
                    <th className="pb-2 text-right font-medium">Appointments</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.daily].reverse().map((d) => (
                    <tr key={d.date} className="border-t border-slate-100">
                      <td className="py-2 text-slate-800">{dayLabel(d.date)}</td>
                      <td className="py-2 text-right font-semibold text-slate-900">{d.leadsWorked}</td>
                      <td className="py-2 text-right">{d.statusChanges}</td>
                      <td className="py-2 text-right">{d.remarks}</td>
                      <td className="py-2 text-right">{d.followUps}</td>
                      <td className="py-2 text-right">{d.appointments}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.truncated && <p className="mt-3 text-xs text-amber-700">Showing the first 20,000 activity entries of this period.</p>}
        </>
      )}
    </section>
  );
}
