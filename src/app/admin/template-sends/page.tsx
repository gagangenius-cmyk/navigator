'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Download, Loader2, XCircle, ArrowLeft, RefreshCw } from 'lucide-react';

interface SendRow {
  id: number; template_name: string; sender_mode: string; status: string; scheduled_at_utc: string | null;
  total_selected: number; total_queued: number; total_skipped: number; created_at: string; completed_at: string | null;
  created_by_name: string | null; sent: string | number | null; failed: string | number | null; pending: string | number | null;
}
interface ItemRow {
  id: number; lead_id: number; lead_name: string | null; to_email: string | null; status: string; reason: string | null;
  attempts: number; subject: string | null; from_email: string | null; sender_name: string | null; sent_at: string | null;
}
interface EventRow { id: number; item_id: number | null; event: string; detail: string | null; created_at: string; actor_name: string | null }

const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-amber-100 text-amber-800', sending: 'bg-amber-100 text-amber-800', scheduled: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800', cancelled: 'bg-gray-200 text-gray-700',
  sent: 'bg-green-100 text-green-800', failed: 'bg-red-100 text-red-800', skipped: 'bg-gray-100 text-gray-700',
};
const badge = (status: string) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
const when = (value: string | null) => (value ? new Date(value.endsWith('Z') ? value : `${value}Z`).toLocaleString() : '—');
const n = (v: string | number | null | undefined) => Number(v || 0);

export default function TemplateSendReportPage() {
  const [sends, setSends] = useState<SendRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [openId, setOpenId] = useState<number | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemStatus, setItemStatus] = useState('');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [job, setJob] = useState<SendRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set('status', status);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await fetch(`/api/template-sends?${qs}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load the report');
      setSends(data.sends); setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the report');
    } finally {
      setLoading(false);
    }
  }, [page, status, from, to]);

  useEffect(() => { void loadList(); }, [loadList]);

  const loadDetail = useCallback(async (id: number, filter: string) => {
    setDetailLoading(true);
    try {
      const [detail, list] = await Promise.all([
        fetch(`/api/template-sends/${id}`).then((r) => r.json()),
        fetch(`/api/template-sends/${id}/items?limit=200${filter ? `&status=${filter}` : ''}`).then((r) => r.json()),
      ]);
      if (detail.success) { setJob(detail.job); setEvents(detail.events || []); }
      if (list.success) { setItems(list.items); setItemsTotal(list.total); }
    } catch (e) {
      // A dropped request keeps the previous detail on screen instead of throwing an unhandled rejection.
      console.error('Failed to load send detail:', e);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { if (openId) void loadDetail(openId, itemStatus); }, [openId, itemStatus, loadDetail]);

  const cancel = async () => {
    if (!openId || !confirm('Cancel this send? Emails already sent stay sent; everything still waiting is stopped.')) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/template-sends/${openId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not cancel');
      await Promise.all([loadDetail(openId, itemStatus), loadList()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not cancel');
    } finally {
      setCancelling(false);
    }
  };

  // ── Detail view ──
  if (openId) {
    const cancellable = job && ['queued', 'scheduled', 'sending'].includes(job.status);
    return (
      <div className="space-y-4 p-4 md:p-6">
        <button onClick={() => { setOpenId(null); setJob(null); setItemStatus(''); void loadList(); }} className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"><ArrowLeft className="h-4 w-4" /> All sends</button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{job?.template_name || `Send #${openId}`}</h1>
            <p className="text-sm text-gray-500">Send #{openId}{job ? ` · ${job.created_by_name || 'Unknown'} · ${when(job.created_at)}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {job && badge(job.status)}
            <a href={`/api/template-sends/${openId}/items?format=csv${itemStatus ? `&status=${itemStatus}` : ''}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"><Download className="h-4 w-4" /> CSV</a>
            {cancellable && (
              <button onClick={cancel} disabled={cancelling} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"><XCircle className="h-4 w-4" /> Cancel send</button>
            )}
          </div>
        </div>

        {job && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[['Selected', job.total_selected], ['Queued', job.total_queued], ['Sent', n(job.sent)], ['Failed', n(job.failed)], ['Skipped', job.total_skipped]].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-3"><div className="text-xs text-gray-500">{label}</div><div className="text-xl font-semibold text-gray-900">{value}</div></div>
            ))}
          </div>
        )}

        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Recipients ({itemsTotal})</h2>
            <select value={itemStatus} onChange={(e) => setItemStatus(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
              <option value="">All</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="skipped">Skipped</option><option value="queued">Waiting</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-4 py-2">Lead</th><th className="px-4 py-2">To</th><th className="px-4 py-2">From</th><th className="px-4 py-2">Subject</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Reason / error</th><th className="px-4 py-2">Sent</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {detailLoading && !items.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>}
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2">#{i.lead_id} {i.lead_name}</td>
                    <td className="px-4 py-2">{i.to_email || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{i.from_email || i.sender_name || '—'}</td>
                    <td className="max-w-[220px] truncate px-4 py-2 text-gray-600" title={i.subject || ''}>{i.subject || '—'}</td>
                    <td className="px-4 py-2">{badge(i.status)}{i.attempts > 1 ? <span className="ml-1 text-xs text-gray-400">×{i.attempts}</span> : null}</td>
                    <td className="max-w-[260px] px-4 py-2 text-xs text-gray-600">{i.reason || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-600">{when(i.sent_at)}</td>
                  </tr>
                ))}
                {!detailLoading && !items.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">Nothing to show.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white">
          <h2 className="border-b px-4 py-3 text-sm font-semibold text-gray-900">Activity log</h2>
          <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-x-3 px-4 py-2">
                <span className="w-40 shrink-0 text-xs text-gray-400">{when(e.created_at)}</span>
                <span className="w-32 shrink-0 font-medium text-gray-800">{e.event.replace(/_/g, ' ')}</span>
                <span className="min-w-0 flex-1 break-words text-xs text-gray-600">{e.item_id ? `item ${e.item_id}: ` : ''}{e.detail || ''}{e.actor_name ? ` (${e.actor_name})` : ''}</span>
              </li>
            ))}
            {!events.length && <li className="px-4 py-6 text-center text-gray-500">No activity yet.</li>}
          </ul>
        </section>
      </div>
    );
  }

  // ── List view ──
  const pages = Math.max(1, Math.ceil(total / 25));
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Mail className="h-6 w-6 text-emerald-600" /><h1 className="text-xl font-semibold text-gray-900">Template send report</h1></div>
        <button onClick={() => void loadList()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <label>Status<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="ml-2 rounded-md border border-gray-300 px-2 py-1">
          <option value="">All</option><option value="queued">Queued</option><option value="scheduled">Scheduled</option><option value="sending">Sending</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
        </select></label>
        <label>From<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="ml-2 rounded-md border border-gray-300 px-2 py-1" /></label>
        <label>To<input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="ml-2 rounded-md border border-gray-300 px-2 py-1" /></label>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Template</th><th className="px-4 py-2">By</th><th className="px-4 py-2">Created</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Sent / queued</th><th className="px-4 py-2">Failed</th><th className="px-4 py-2">Skipped</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>}
            {!loading && sends.map((s) => (
              <tr key={s.id} onClick={() => setOpenId(s.id)} className="cursor-pointer hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-500">{s.id}</td>
                <td className="px-4 py-2 font-medium text-gray-900">{s.template_name}</td>
                <td className="px-4 py-2 text-gray-600">{s.created_by_name || '—'}</td>
                <td className="whitespace-nowrap px-4 py-2 text-gray-600">{when(s.created_at)}</td>
                <td className="px-4 py-2">{badge(s.status)}{s.status === 'scheduled' && s.scheduled_at_utc ? <span className="ml-1 text-xs text-gray-500">{when(s.scheduled_at_utc)}</span> : null}</td>
                <td className="px-4 py-2">{n(s.sent)} / {s.total_queued}</td>
                <td className={`px-4 py-2 ${n(s.failed) ? 'font-semibold text-red-600' : 'text-gray-500'}`}>{n(s.failed)}</td>
                <td className="px-4 py-2 text-gray-500">{s.total_skipped}</td>
              </tr>
            ))}
            {!loading && !sends.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No sends yet. Select leads on the Leads page and choose “Send template”.</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40">Previous</button>
          <span className="text-gray-500">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
