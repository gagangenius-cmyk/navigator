'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

// The drill-down behind a counselor on the manager dashboard: that counselor's lead data in one popup - how many
// leads sit in each status, what they did today (from the lead activity log) and the leads themselves, filterable by
// status. Reads /api/admin/dashboard/daily-work?employeeId= (the server decides who may look at whom) and
// /api/leads?assignTo= (which applies the viewer's own visibility).

interface Work {
  totals: { leadsWorked: number; statusChanges: number; remarks: number; followUps: number; appointments: number; whatsapp: number; followUpsHandled?: number; appointmentsHandled?: number };
  snapshot: Array<{ status: string; count: number }>;
  snapshotTotal: number;
}

interface PopupLead {
  id: number;
  fname?: string | null;
  lname?: string | null;
  phone?: string | null;
  mobile?: string | null;
  status?: string | null;
  followup?: string | null;
  folowuptime?: string | null;
  followupstat?: number | string | null;
  latest_remark?: string | null;
}

const PAGE_SIZE = 20;

export default function CounselorLeadsPopup({ employeeId, name, onClose }: { employeeId: number; name: string; onClose: () => void }) {
  const [work, setWork] = useState<Work | null>(null);
  const [status, setStatus] = useState('');
  const [leads, setLeads] = useState<PopupLead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/dashboard/daily-work?employeeId=${employeeId}&days=1`, { cache: 'no-store' })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (ok && j.data) setWork(j.data);
        else setError(j.error || 'Failed to load counselor summary');
      })
      .catch(() => { if (!cancelled) setError('Failed to load counselor summary'); });
    return () => { cancelled = true; };
  }, [employeeId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ opportunityView: 'all', assignTo: String(employeeId), limit: String(PAGE_SIZE), page: String(page) });
        if (status) params.set('status', status);
        const res = await fetch(`/api/leads?${params}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Failed to load leads');
        if (cancelled) return;
        setLeads(json.leads || json.data || []);
        setTotal(Number(json.pagination?.total || 0));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load leads');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId, status, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pick = (next: string) => { setStatus(next); setPage(1); };
  const nextFollowUp = (l: PopupLead) =>
    Number(l.followupstat) === 0 && l.followup ? `${String(l.followup).slice(0, 10)} ${String(l.folowuptime || '').slice(0, 5)}`.trim() : '—';
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`;

  const todayTiles: Array<[string, number]> = work
    ? [
        ['Leads worked', work.totals.leadsWorked],
        ['Status updates', work.totals.statusChanges],
        ['Remarks', work.totals.remarks],
        ['Follow-ups set', work.totals.followUps],
        ['Follow-ups done', work.totals.followUpsHandled || 0],
        ['Appointments', work.totals.appointments],
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{name}</h2>
            <p className="text-sm text-gray-500">{work ? `${work.snapshotTotal.toLocaleString()} leads` : 'Loading…'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-auto">
          {work && (
            <div className="border-b px-5 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Today</p>
              <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                {todayTiles.map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-gray-50 px-2 py-2">
                    <p className="text-lg font-bold text-gray-900">{value.toLocaleString()}</p>
                    <p className="text-[11px] text-gray-500">{label}</p>
                  </div>
                ))}
              </div>
              <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Leads by status</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => pick('')} className={chip(status === '')}>All ({work.snapshotTotal})</button>
                {work.snapshot.map((s) => (
                  <button key={s.status} type="button" onClick={() => pick(s.status)} className={chip(status === s.status)}>{s.status} ({s.count})</button>
                ))}
              </div>
            </div>
          )}

          {error ? (
            <div className="p-6 text-sm text-red-600">{error}</div>
          ) : leads.length === 0 && !loading ? (
            <div className="p-6 text-center text-sm text-gray-500">No leads found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">Lead</th>
                  <th className="px-4 py-2">Phone</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Next follow-up</th>
                  <th className="px-4 py-2">Latest remark</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-t border-gray-100 hover:bg-blue-50/40">
                    <td className="px-4 py-2">
                      <Link href={`/admin/leads/${lead.id}/edit`} className="font-medium text-blue-700 hover:underline">
                        {`${lead.fname || ''} ${lead.lname || ''}`.trim() || `Lead #${lead.id}`}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{lead.mobile || lead.phone || '—'}</td>
                    <td className="px-4 py-2 text-gray-700">{lead.status || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-700">{nextFollowUp(lead)}</td>
                    <td className="max-w-[240px] truncate px-4 py-2 text-xs text-gray-600" title={lead.latest_remark || undefined}>{lead.latest_remark || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-gray-500">
          <span>{loading ? 'Loading…' : `${total.toLocaleString()} lead${total === 1 ? '' : 's'} · page ${page} of ${pages}`}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-100 disabled:opacity-50">Previous</button>
            <button type="button" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-100 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
