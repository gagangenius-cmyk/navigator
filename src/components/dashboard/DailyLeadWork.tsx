'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
export default function DailyLeadWork({ employeeId }: { employeeId?: number }) {
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<DailyWorkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const today = dubaiToday();
      const date = period === 'yesterday' ? dubaiToday(-1) : today;
      const days = period === 'today' || period === 'yesterday' ? 1 : Number(period);
      const params = new URLSearchParams({ date, days: String(days) });
      if (employeeId) params.set('employeeId', String(employeeId));
      const res = await fetch(`/api/admin/dashboard/daily-work?${params}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Server returned ${res.status}`);
      setData(json.data as DailyWorkData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [period, employeeId]);

  useEffect(() => { void load(); }, [load]);

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
              onClick={() => setPeriod(p.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${period === p.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {p.label}
            </button>
          ))}
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
