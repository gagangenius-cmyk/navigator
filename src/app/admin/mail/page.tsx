'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Inbox, Send, RefreshCw, PenSquare, Reply, AlertCircle, CheckCircle } from 'lucide-react';

interface MessageRow {
  id: number;
  direction: 'in' | 'out';
  from_address: string | null;
  from_name: string | null;
  to_addresses: string | null;
  subject: string | null;
  preview: string;
  lead_id: number | null;
  lead_name: string | null;
  is_read: number;
  status: string;
  error: string | null;
  message_date: string;
}

interface MessageDetail extends MessageRow {
  body_text: string | null;
  message_id: string | null;
}

function MailContent() {
  const params = useSearchParams();
  const [box, setBox] = useState<'inbox' | 'sent'>('inbox');
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [mailbox, setMailbox] = useState<{ email: string; imap_host: string | null; last_error: string | null } | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string; inReplyTo: string | null; leadId: number | null } | null>(
    params.get('to') ? { to: params.get('to') || '', subject: '', body: '', inReplyTo: null, leadId: Number(params.get('leadId')) || null } : null,
  );
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ box });
      if (search) qs.set('q', search);
      const res = await fetch(`/api/mail/messages?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load mail');
      setRows(json.data || []);
      setMailbox(json.mailbox);
      setUnread(json.unread || 0);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mail');
    } finally {
      setLoading(false);
    }
  }, [box, search]);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    setError('');
    try {
      const res = await fetch('/api/mail/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      setNotice(`${json.fetched} new message(s)`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const open = async (row: MessageRow) => {
    const res = await fetch(`/api/mail/messages/${row.id}`);
    const json = await res.json();
    if (res.ok) {
      setSelected(json.data);
      if (row.direction === 'in' && !row.is_read) {
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_read: 1 } : r)));
        setUnread((u) => Math.max(0, u - 1));
      }
    }
  };

  const reply = (m: MessageDetail) =>
    setCompose({
      to: m.from_address || '',
      subject: /^re:/i.test(m.subject || '') ? m.subject || '' : `Re: ${m.subject || ''}`,
      body: `\n\n--- On ${new Date(m.message_date).toLocaleString()}, ${m.from_name || m.from_address} wrote ---\n${(m.body_text || '').split('\n').map((l) => `> ${l}`).join('\n')}`,
      inReplyTo: m.message_id,
      leadId: m.lead_id,
    });

  const send = async () => {
    if (!compose) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/mail/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(compose) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send');
      setCompose(null);
      setNotice('Email sent');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';

  if (!loading && !mailbox) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4" /> No mailbox is connected to your account yet. Ask the CEO to connect your SMTP mailbox under Counselor Mailboxes.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Mail</h1>
          <p className="text-sm text-gray-600">{mailbox?.email}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={sync} disabled={syncing || !mailbox?.imap_host} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={() => setCompose({ to: '', subject: '', body: '', inReplyTo: null, leadId: null })} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
            <PenSquare className="h-4 w-4" /> Compose
          </button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {error}</div>}
      {notice && <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"><CheckCircle className="h-4 w-4" /> {notice}</div>}
      {mailbox?.last_error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">Mailbox issue: {mailbox.last_error}. Tell the CEO if this persists.</div>}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { setBox('inbox'); setSelected(null); }} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${box === 'inbox' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 shadow'}`}>
          <Inbox className="h-4 w-4" /> Inbox{unread > 0 && <span className="rounded-full bg-white/90 px-1.5 text-xs text-blue-700">{unread}</span>}
        </button>
        <button onClick={() => { setBox('sent'); setSelected(null); }} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${box === 'sent' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 shadow'}`}>
          <Send className="h-4 w-4" /> Sent
        </button>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subject or address…" className="ml-auto w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="overflow-hidden rounded-lg bg-white shadow lg:col-span-2">
          {loading ? <div className="p-6 text-sm text-gray-500">Loading…</div> : rows.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">No messages.</div>
          ) : rows.map((r) => (
            <button key={r.id} onClick={() => open(r)} className={`block w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${selected?.id === r.id ? 'bg-blue-50' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm ${r.direction === 'in' && !r.is_read ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                  {r.direction === 'in' ? (r.from_name || r.from_address) : `To: ${r.to_addresses}`}
                </span>
                <span className="shrink-0 text-xs text-gray-400">{new Date(r.message_date).toLocaleDateString()}</span>
              </div>
              <div className="truncate text-sm text-gray-800">{r.subject}</div>
              <div className="truncate text-xs text-gray-500">{r.preview}</div>
              <div className="mt-1 flex gap-2">
                {r.lead_name && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">Lead: {r.lead_name}</span>}
                {r.status === 'failed' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Failed</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-lg bg-white p-5 shadow lg:col-span-3">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-900">{selected.subject}</h2>
                {selected.direction === 'in' && (
                  <button onClick={() => reply(selected)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100"><Reply className="h-4 w-4" /> Reply</button>
                )}
              </div>
              <div className="text-xs text-gray-500">
                From {selected.from_name ? `${selected.from_name} <${selected.from_address}>` : selected.from_address} · To {selected.to_addresses} · {new Date(selected.message_date).toLocaleString()}
                {selected.lead_name && <> · Lead: <a className="text-blue-600 underline" href={`/admin/leads/${selected.lead_id}`}>{selected.lead_name}</a></>}
              </div>
              {selected.error && <div className="text-sm text-red-600">{selected.error}</div>}
              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">{selected.body_text || '(no text content)'}</pre>
            </div>
          ) : <div className="text-sm text-gray-500">Select a message to read it.</div>}
        </div>
      </div>

      {compose && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-2xl space-y-3 rounded-lg bg-white p-5 shadow-xl">
            <h3 className="font-semibold text-gray-900">{compose.inReplyTo ? 'Reply' : 'New message'}</h3>
            <input className={input} placeholder="To" value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} />
            <input className={input} placeholder="Subject" value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} />
            <textarea className={input} rows={10} placeholder="Message" value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} />
            <div className="flex justify-end gap-3">
              <button onClick={() => setCompose(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
              <button onClick={send} disabled={sending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400">{sending ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MailPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">Loading…</div>}>
      <MailContent />
    </Suspense>
  );
}
