'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Plus, RefreshCw, Trash2, CheckCircle, AlertCircle, Power } from 'lucide-react';

interface Mailbox {
  id: number;
  employee_id: number;
  employee_name: string | null;
  email: string;
  display_name: string | null;
  smtp_host: string;
  smtp_port: number;
  imap_host: string | null;
  is_active: number;
  daily_limit: number;
  sent_today: number;
  unread: number;
  last_test_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}

const emptyForm = {
  employeeId: '', email: '', displayName: '', username: '', password: '',
  smtpHost: '', smtpPort: '587', smtpSecure: false,
  imapHost: '', imapPort: '993', imapSecure: true,
  dailyLimit: '200', signature: '',
};

export default function MailboxesAdminPage() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/mailboxes');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load mailboxes');
      setMailboxes(json.data || []);
      setEmployees(json.availableEmployees || []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mailboxes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, employeeId: Number(form.employeeId) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to connect mailbox');
      setForm(emptyForm);
      setShowForm(false);
      setNotice('Mailbox connected. Use "Test" to verify the credentials.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect mailbox');
    } finally {
      setSaving(false);
    }
  };

  const act = async (mb: Mailbox, action: 'test' | 'toggle' | 'sync' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Revoke ${mb.email}? Credentials and cached mail for this mailbox will be deleted.`)) return;
    setBusyId(mb.id);
    setError('');
    setNotice('');
    try {
      let res: Response;
      if (action === 'test') res = await fetch(`/api/admin/mailboxes/${mb.id}/test`, { method: 'POST' });
      else if (action === 'sync') res = await fetch('/api/mail/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mailboxId: mb.id }) });
      else if (action === 'delete') res = await fetch(`/api/admin/mailboxes/${mb.id}`, { method: 'DELETE' });
      else res = await fetch(`/api/admin/mailboxes/${mb.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !mb.is_active }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Action failed');
      if (action === 'test') setNotice(`${mb.email} — SMTP: ${json.result.smtp}, IMAP: ${json.result.imap}`);
      if (action === 'sync') setNotice(`${mb.email} — ${json.fetched} new message(s) fetched`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900"><Mail className="h-7 w-7 text-blue-600" /> Counselor Mailboxes</h1>
          <p className="mt-2 text-gray-600">Connect each counselor&apos;s own SMTP/IMAP mailbox. Counselors send and receive client email from the CRM; passwords are encrypted and never shown.</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Connect Mailbox
        </button>
      </div>

      {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {error}</div>}
      {notice && <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"><CheckCircle className="h-4 w-4" /> {notice}</div>}

      {showForm && (
        <div className="rounded-lg bg-white p-6 shadow space-y-4">
          <h2 className="font-semibold text-gray-900">Connect a mailbox</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="text-sm">Counselor
              <select className={field} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">Select…</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label className="text-sm">Email address
              <input className={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value, username: form.username || e.target.value })} placeholder="counselor@company.com" />
            </label>
            <label className="text-sm">Display name
              <input className={field} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </label>
            <label className="text-sm">Login username
              <input className={field} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </label>
            <label className="text-sm">Password / app password
              <input type="password" autoComplete="new-password" className={field} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </label>
            <label className="text-sm">Daily send limit
              <input type="number" className={field} value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} />
            </label>
            <label className="text-sm">SMTP host
              <input className={field} value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} placeholder="smtp.company.com" />
            </label>
            <label className="text-sm">SMTP port
              <input type="number" className={field} value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: e.target.value })} />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={form.smtpSecure} onChange={(e) => setForm({ ...form, smtpSecure: e.target.checked })} /> SSL from the start (port 465). Leave off for STARTTLS (587).
            </label>
            <label className="text-sm">IMAP host (for inbox/replies)
              <input className={field} value={form.imapHost} onChange={(e) => setForm({ ...form, imapHost: e.target.value })} placeholder="imap.company.com" />
            </label>
            <label className="text-sm">IMAP port
              <input type="number" className={field} value={form.imapPort} onChange={(e) => setForm({ ...form, imapPort: e.target.value })} />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={form.imapSecure} onChange={(e) => setForm({ ...form, imapSecure: e.target.checked })} /> IMAP over SSL (993)
            </label>
          </div>
          <label className="block text-sm">Signature (optional)
            <textarea rows={3} className={field} value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} />
          </label>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
            <button onClick={create} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400">
              {saving ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg bg-white shadow">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Counselor</th><th className="px-4 py-3">Mailbox</th><th className="px-4 py-3">Servers</th>
              <th className="px-4 py-3">Today</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : mailboxes.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No mailboxes connected yet.</td></tr>
            ) : mailboxes.map((mb) => (
              <tr key={mb.id} className="border-t border-gray-100 align-top">
                <td className="px-4 py-3 font-medium">{mb.employee_name || `#${mb.employee_id}`}</td>
                <td className="px-4 py-3">{mb.email}{mb.unread > 0 && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{mb.unread} unread</span>}</td>
                <td className="px-4 py-3 text-gray-600">SMTP {mb.smtp_host}:{mb.smtp_port}<br />IMAP {mb.imap_host || '—'}</td>
                <td className="px-4 py-3">{mb.sent_today} / {mb.daily_limit} sent</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${mb.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>{mb.is_active ? 'Active' : 'Disabled'}</span>
                  {mb.last_error && <div className="mt-1 max-w-xs text-xs text-red-600">{mb.last_error}</div>}
                  {mb.last_sync_at && !mb.last_error && <div className="mt-1 text-xs text-gray-500">Synced {new Date(mb.last_sync_at).toLocaleString()}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button disabled={busyId === mb.id} onClick={() => act(mb, 'test')} className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100">Test</button>
                    <button disabled={busyId === mb.id || !mb.imap_host} onClick={() => act(mb, 'sync')} title="Fetch new mail now" className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"><RefreshCw className="h-3.5 w-3.5" /></button>
                    <button disabled={busyId === mb.id} onClick={() => act(mb, 'toggle')} title={mb.is_active ? 'Disable' : 'Enable'} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"><Power className="h-3.5 w-3.5" /></button>
                    <button disabled={busyId === mb.id} onClick={() => act(mb, 'delete')} title="Revoke" className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
