'use client';

import { useState, useEffect, useCallback } from 'react';
import { ListChecks, Search, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface AuditEntry {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  summary: string | null;
  actorId: number | null;
  actorName: string;
  actorRole: string | null;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown> | null;
  createdAt: string;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  opportunity_payment: 'Payment',
  role_permissions: 'Role Permissions',
  employee: 'Employee',
  discount_approval: 'Discount Approval',
  compliance_approval: 'Compliance Approval',
};

const formatDateTime = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

export default function AuditLogPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (entityType) params.set('entityType', entityType);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/audit-log?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json();
      if (res.ok) {
        setRows(data.data || []);
        setTotalPages(data.pagination?.totalPages || 1);
        setTotal(data.pagination?.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, entityType, search, token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-gray-500" />
          Audit Log
        </h1>
        <p className="text-sm text-gray-500">
          Who changed what, when — payment verifications, role/permission changes, employee account
          changes, and discount/compliance approval decisions. Read-only; entries can&apos;t be edited or deleted.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          This covers the mutation paths wired up so far. Not every admin action is logged here yet —
          lead-level activity (remarks, follow-ups, appointments) has its own history on each lead&apos;s
          Activity tab.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search summary, action, or entity id..."
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <select
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">All entity types</option>
          {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">When</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Actor</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Action</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Entity</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No audit entries found.</td></tr>
              ) : rows.map((row) => (
                <>
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500">{formatDateTime(row.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-900">
                      {row.actorName}
                      {row.actorRole && <span className="ml-1 text-xs text-gray-400">({row.actorRole})</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {row.action}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                      {ENTITY_TYPE_LABELS[row.entityType] || row.entityType} #{row.entityId}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{row.summary || '—'}</td>
                  </tr>
                  {expandedId === row.id && (row.beforeValue || row.afterValue) && (
                    <tr key={`${row.id}-detail`} className="bg-gray-50">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {row.beforeValue && (
                            <div>
                              <div className="mb-1 text-xs font-semibold uppercase text-gray-400">Before</div>
                              <pre className="whitespace-pre-wrap rounded-lg bg-white p-2 text-xs text-gray-600 border border-gray-200">{JSON.stringify(row.beforeValue, null, 2)}</pre>
                            </div>
                          )}
                          {row.afterValue && (
                            <div>
                              <div className="mb-1 text-xs font-semibold uppercase text-gray-400">After</div>
                              <pre className="whitespace-pre-wrap rounded-lg bg-white p-2 text-xs text-gray-600 border border-gray-200">{JSON.stringify(row.afterValue, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-sm text-gray-500">
          <span>{total.toLocaleString()} total entries</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-gray-300 p-1.5 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-gray-300 p-1.5 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
