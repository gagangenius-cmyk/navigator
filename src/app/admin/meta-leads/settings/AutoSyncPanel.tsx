'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface SyncForm {
  form_id: string;
  form_name: string | null;
  status: string | null;
  question_count: number;
  auto_mapped_count: number;
  leads_count: number;
  last_synced_at: string | null;
}

interface SyncStatus {
  config: { pageId: string | null; adAccountId: string | null; enabled: boolean };
  lastAutoSyncAt: string | null;
  webhookSubscribedAt: string | null;
  lastSummary: { errors?: string[]; backfill?: { recovered: number }; forms?: { newForms: number; mappingsCreated: number } } | null;
  forms: SyncForm[];
  tokenHealth: { isValid: boolean; expiresAt: string | null; error?: string };
}

export default function AutoSyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<'sync' | 'webhook' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/meta-leads/sync');
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const run = async (registerWebhook: boolean) => {
    setBusy(registerWebhook ? 'webhook' : 'sync');
    setMessage(null);
    try {
      const res = await fetch('/api/admin/meta-leads/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registerWebhook }),
      });
      const s = await res.json();
      setMessage(s.skipped ? `Skipped: ${s.skipped}` : s.errors?.length ? `Finished with issues: ${s.errors.join(' • ')}` : 'Sync complete.');
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(null);
    }
  };

  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : 'never');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium text-gray-900">Auto-Sync with Meta</h2>
          <p className="text-xs text-gray-500">
            New campaigns, lead forms and form questions are discovered and mapped automatically (every 15 min, and instantly when a lead from a new form arrives).
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => run(false)} disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Sync now
          </button>
          <button onClick={() => run(true)} disabled={!!busy}
            title="Registers this site's /api/webhooks/meta URL with your Meta app"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            Register webhook
          </button>
        </div>
      </div>

      {message && <p className="text-sm text-gray-700">{message}</p>}

      {status && (
        <>
          <div className="grid grid-cols-1 gap-2 text-xs text-gray-600 sm:grid-cols-3">
            <div>Last auto-sync: <b>{fmt(status.lastAutoSyncAt)}</b></div>
            <div>Page subscribed: <b>{fmt(status.webhookSubscribedAt)}</b></div>
            <div>
              Page token:{' '}
              <b className={status.tokenHealth.isValid ? 'text-green-700' : 'text-red-600'}>
                {status.tokenHealth.isValid ? (status.tokenHealth.expiresAt ? `valid until ${fmt(status.tokenHealth.expiresAt)}` : 'valid, no expiry') : `invalid${status.tokenHealth.error ? ` (${status.tokenHealth.error})` : ''}`}
              </b>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-gray-500">
                <tr><th className="py-1 pr-3">Form</th><th className="pr-3">Status</th><th className="pr-3">Questions</th><th className="pr-3">Auto-mapped</th><th>Leads</th></tr>
              </thead>
              <tbody>
                {status.forms.length === 0 && <tr><td colSpan={5} className="py-2 text-gray-400">No forms discovered yet — click Sync now.</td></tr>}
                {status.forms.map(f => (
                  <tr key={f.form_id} className="border-t border-gray-100">
                    <td className="py-1 pr-3">{f.form_name || f.form_id}</td>
                    <td className="pr-3">{f.status || '—'}</td>
                    <td className="pr-3">{f.question_count}</td>
                    <td className="pr-3">{f.auto_mapped_count}</td>
                    <td>{f.leads_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
