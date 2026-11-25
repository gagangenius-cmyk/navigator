'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

// The drill-down behind a lead-status number on the dashboard / analytics: lists the leads that make up that
// number. Reads /api/leads?opportunityView=all, which applies the caller's own visibility (a Team Leader sees
// every lead, a counselor only theirs), so the list always matches what the viewer's numbers count.

interface PopupLead {
  id: number;
  fname?: string | null;
  lname?: string | null;
  phone?: string | null;
  mobile?: string | null;
  status?: string | null;
  priority?: string | null;
  assigned_to_name?: string | null;
  branch_name?: string | null;
}

const PAGE_SIZE = 25;

export default function LeadStatusPopup({
  status,
  priority,
  onClose,
}: {
  status: string;
  priority?: string;
  onClose: () => void;
}) {
  const [leads, setLeads] = useState<PopupLead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ opportunityView: 'all', status, limit: String(PAGE_SIZE), page: String(page) });
        if (priority) params.set('priority', priority);
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
  }, [status, priority, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{status}{priority ? ` · ${priority}` : ''} leads</h2>
            <p className="text-sm text-gray-500">{loading ? 'Loading…' : `${total.toLocaleString()} lead${total === 1 ? '' : 's'}`}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
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
                  <th className="px-4 py-2">Assigned to</th>
                  <th className="px-4 py-2">Branch</th>
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
                    <td className="px-4 py-2 text-gray-700">{lead.assigned_to_name || 'Unassigned'}</td>
                    <td className="px-4 py-2 text-gray-700">{lead.branch_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-gray-500">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-100 disabled:opacity-50">Previous</button>
            <button type="button" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-100 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
