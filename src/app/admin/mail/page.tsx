'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Inbox, Send, Star, Archive, Trash2, RefreshCw, PenSquare, Reply, ReplyAll, Forward, AlertCircle, CheckCircle,
  Paperclip, Mail as MailIcon, MailOpen, RotateCcw, X, Link2, Eye,
} from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';

type Folder = 'inbox' | 'starred' | 'sent' | 'archive' | 'trash';

interface Row {
  id: number; direction: 'in' | 'out'; folder: string; from_address: string | null; from_name: string | null;
  to_addresses: string | null; subject: string | null; preview: string; lead_id: number | null; lead_name: string | null;
  is_read: number; is_starred: number; has_attachments: number; status: string; message_date: string; thread_count: number;
}
interface Attachment { id: number; filename: string; size: number; content_type: string | null }
interface ThreadMessage {
  id: number; direction: 'in' | 'out'; folder: string; message_id: string | null; from_address: string | null; from_name: string | null;
  to_addresses: string | null; cc_addresses: string | null; subject: string | null; body_text: string | null; body_html: string | null;
  lead_id: number | null; lead_name: string | null; is_starred: number; status: string; error: string | null; message_date: string; attachments: Attachment[];
}
interface Compose {
  to: string; cc: string; bcc: string; subject: string; body: string; inReplyTo: string | null;
  leadId: number | null; leadName: string | null; files: File[];
}
interface MailboxInfo { id: number; email: string; imap_host: string | null; last_error: string | null; last_sync_at: string | null; employee_name?: string | null }

const MAX_FILES_BYTES = 4 * 1024 * 1024;
const FOLDERS: { key: Folder; label: string; icon: typeof Inbox }[] = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'archive', label: 'Archive', icon: Archive },
  { key: 'trash', label: 'Trash', icon: Trash2 },
];
const emptyCompose = (): Compose => ({ to: '', cc: '', bcc: '', subject: '', body: '', inReplyTo: null, leadId: null, leadName: null, files: [] });

const formatWhen = (value: string) => {
  const d = new Date(value);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};
const formatSize = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// Incoming HTML is untrusted: rendered in a fully sandboxed iframe (no scripts,
// no same-origin access) with a CSP that also blocks remote images, so
// tracking pixels and phishing payloads can't phone home.
function HtmlBody({ html }: { html: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:14px;margin:0;color:#111}</style></head><body>${html}</body></html>`;
  return <iframe sandbox="" srcDoc={doc} title="Email content" className="h-96 w-full rounded border border-gray-200 bg-white" />;
}

function MailContent() {
  const params = useSearchParams();
  const [folder, setFolder] = useState<Folder>('inbox');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [withAttachments, setWithAttachments] = useState(false);
  const [mailboxId, setMailboxId] = useState<number | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0 });
  const [counts, setCounts] = useState({ inbox_unread: 0, starred: 0, trash: 0, archive: 0 });
  const [mailbox, setMailbox] = useState<MailboxInfo | null>(null);
  const [allMailboxes, setAllMailboxes] = useState<{ id: number; email: string; employee_name: string | null; unread: number }[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [showHtml, setShowHtml] = useState(true);

  const [compose, setCompose] = useState<Compose | null>(
    params.get('to') ? { ...emptyCompose(), to: params.get('to') || '', leadId: Number(params.get('leadId')) || null } : null,
  );
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [leadQuery, setLeadQuery] = useState('');
  const [leadResults, setLeadResults] = useState<{ id: number; name: string; email: string }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams({ folder, page: String(page) });
      if (debouncedSearch) qs.set('q', debouncedSearch);
      if (unreadOnly) qs.set('unread', '1');
      if (withAttachments) qs.set('attachments', '1');
      if (mailboxId) qs.set('mailboxId', String(mailboxId));
      if (params.get('leadId') && !compose) qs.set('leadId', params.get('leadId') as string);
      const res = await fetch(`/api/mail/messages?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load mail');
      setRows(json.data || []);
      setPagination({ total: json.pagination?.total || 0, totalPages: json.pagination?.totalPages || 0 });
      setCounts(json.counts || { inbox_unread: 0, starred: 0, trash: 0, archive: 0 });
      setMailbox(json.mailbox);
      setAllMailboxes(json.mailboxes || []);
      setReadOnly(Boolean(json.readOnly));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mail');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, page, debouncedSearch, unreadOnly, withAttachments, mailboxId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setChecked(new Set()); }, [folder, debouncedSearch, unreadOnly, withAttachments, mailboxId]);
  useEffect(() => { document.title = counts.inbox_unread > 0 ? `(${counts.inbox_unread}) Mail` : 'Mail'; }, [counts.inbox_unread]);

  const sync = useCallback(async (silent = false) => {
    if (readOnly || !mailbox?.imap_host) return;
    if (!silent) setSyncing(true);
    try {
      const res = await fetch('/api/mail/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      if (!silent) setNotice(json.fetched ? `${json.fetched} new message(s)` : 'You are up to date');
      if (json.fetched || !silent) await load(true);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [readOnly, mailbox?.imap_host, load]);

  // Background refresh while the tab is open and visible.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') sync(true); }, 120_000);
    return () => clearInterval(timer);
  }, [sync]);

  useEffect(() => {
    if (leadQuery.trim().length < 2) { setLeadResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/mail/leads?q=${encodeURIComponent(leadQuery)}`);
      if (res.ok) setLeadResults((await res.json()).data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [leadQuery]);

  const openThread = async (row: Row) => {
    setOpenId(row.id);
    const res = await fetch(`/api/mail/messages/${row.id}`);
    const json = await res.json();
    if (res.ok) {
      setThread(json.data);
      if (!readOnly && !row.is_read) {
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_read: 1 } : r)));
        setCounts((c) => ({ ...c, inbox_unread: Math.max(0, c.inbox_unread - 1) }));
      }
    } else setError(json.error || 'Failed to open message');
  };

  const act = async (ids: number[], action: string, extra: Record<string, unknown> = {}) => {
    if (!ids.length || readOnly) return;
    if (action === 'purge' && !window.confirm(`Permanently delete ${ids.length} message(s)? This cannot be undone.`)) return;
    const res = await fetch('/api/mail/messages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, action, ...extra }) });
    const json = await res.json();
    if (!res.ok) { setError(json.error || 'Action failed'); return; }
    setChecked(new Set());
    if (['archive', 'trash', 'restore', 'purge'].includes(action) && openId && ids.includes(openId)) { setOpenId(null); setThread([]); }
    await load(true);
  };

  const toggleCheck = (id: number) => setChecked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));
  const last = thread[thread.length - 1];
  const myEmail = mailbox?.email?.toLowerCase() || '';

  const quote = (m: ThreadMessage) =>
    `\n\n--- On ${new Date(m.message_date).toLocaleString()}, ${m.from_name || m.from_address} wrote ---\n${(m.body_text || '').split('\n').map((l) => `> ${l}`).join('\n')}`;
  const withRe = (s: string | null, prefix: string) => (new RegExp(`^${prefix}:`, 'i').test(s || '') ? s || '' : `${prefix}: ${s || ''}`);

  const startReply = (m: ThreadMessage, all: boolean) => {
    const others = all
      ? [...(m.to_addresses || '').split(','), ...(m.cc_addresses || '').split(',')].map((a) => a.trim().toLowerCase()).filter((a) => a && a !== myEmail && a !== (m.from_address || '').toLowerCase())
      : [];
    const target = m.direction === 'in' ? m.from_address || '' : m.to_addresses || '';
    setCompose({ ...emptyCompose(), to: target, cc: others.join(', '), subject: withRe(m.subject, 'Re'), body: quote(m), inReplyTo: m.message_id, leadId: m.lead_id, leadName: m.lead_name });
    setShowCcBcc(others.length > 0);
  };
  const startForward = (m: ThreadMessage) =>
    setCompose({ ...emptyCompose(), subject: withRe(m.subject, 'Fwd'), body: `\n\n--- Forwarded message ---\nFrom: ${m.from_name || ''} <${m.from_address}>\nDate: ${new Date(m.message_date).toLocaleString()}\nSubject: ${m.subject}\n\n${m.body_text || ''}`, leadId: m.lead_id, leadName: m.lead_name });

  const addFiles = (list: FileList | null) => {
    if (!compose || !list) return;
    const merged = [...compose.files, ...Array.from(list)];
    if (merged.reduce((s, f) => s + f.size, 0) > MAX_FILES_BYTES) { setError('Attachments are limited to 4 MB in total.'); return; }
    setCompose({ ...compose, files: merged });
  };

  const closeCompose = () => {
    if (compose && compose.body.trim() && !window.confirm('Discard this message?')) return;
    setCompose(null);
    setShowCcBcc(false);
  };

  const send = async () => {
    if (!compose) return;
    setSending(true);
    setError('');
    try {
      const form = new FormData();
      (['to', 'cc', 'bcc', 'subject', 'body'] as const).forEach((k) => form.set(k, compose[k]));
      if (compose.inReplyTo) form.set('inReplyTo', compose.inReplyTo);
      if (compose.leadId) form.set('leadId', String(compose.leadId));
      compose.files.forEach((f) => form.append('files', f));
      const res = await fetch('/api/mail/send', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send');
      setCompose(null);
      setShowCcBcc(false);
      setNotice('Email sent');
      await load(true);
      if (openId) openThread({ id: openId, is_read: 1 } as Row);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
  const hasLeadFilter = Boolean(params.get('leadId'));
  const title = useMemo(() => FOLDERS.find((f) => f.key === folder)?.label, [folder]);

  if (!loading && !mailbox && !allMailboxes.length) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4" /> No mailbox is connected to your account yet. Ask the CEO to connect your SMTP mailbox under Counselor Mailboxes.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mail</h1>
          <p className="text-sm text-gray-600">{mailbox?.email}{mailbox?.last_sync_at ? ` · synced ${new Date(mailbox.last_sync_at).toLocaleTimeString()}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allMailboxes.length > 0 && (
            <select value={mailboxId ?? ''} onChange={(e) => { setMailboxId(e.target.value ? Number(e.target.value) : null); setOpenId(null); setThread([]); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">My mailbox</option>
              {allMailboxes.map((m) => <option key={m.id} value={m.id}>{m.employee_name || m.email} ({m.unread} unread)</option>)}
            </select>
          )}
          <button onClick={() => sync(false)} disabled={syncing || readOnly || !mailbox?.imap_host} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={() => setCompose(emptyCompose())} disabled={readOnly} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-400">
            <PenSquare className="h-4 w-4" /> Compose
          </button>
        </div>
      </div>

      {readOnly && <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800"><Eye className="h-4 w-4" /> Viewing {mailbox?.email} in read-only mode. Your views are recorded in the audit log.</div>}
      {error && <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"><span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {error}</span><button onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}
      {notice && <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700"><span className="flex items-center gap-2"><CheckCircle className="h-4 w-4" /> {notice}</span><button onClick={() => setNotice('')}><X className="h-4 w-4" /></button></div>}
      {mailbox?.last_error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">Mailbox issue: {mailbox.last_error}. Tell the CEO if this persists.</div>}
      {hasLeadFilter && <div className="rounded-lg bg-indigo-50 px-4 py-2 text-sm text-indigo-800">Showing mail linked to lead #{params.get('leadId')} · <a className="underline" href="/admin/mail">clear</a></div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* Folder rail */}
        <nav className="flex gap-2 overflow-x-auto lg:col-span-2 lg:flex-col">
          {FOLDERS.map(({ key, label, icon: Icon }) => {
            const badge = key === 'inbox' ? counts.inbox_unread : key === 'starred' ? counts.starred : key === 'archive' ? counts.archive : key === 'trash' ? counts.trash : 0;
            return (
              <button key={key} onClick={() => { setFolder(key); setOpenId(null); setThread([]); }} className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${folder === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 shadow hover:bg-gray-50'}`}>
                <span className="flex items-center gap-2"><Icon className="h-4 w-4" /> {label}</span>
                {badge > 0 && <span className={`rounded-full px-1.5 text-xs ${folder === key ? 'bg-white/90 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{badge}</span>}
              </button>
            );
          })}
        </nav>

        {/* Message list */}
        <section className="overflow-hidden rounded-lg bg-white shadow lg:col-span-4">
          <div className="space-y-2 border-b border-gray-100 p-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${title?.toLowerCase()}…`} className={field} />
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
              <label className="flex items-center gap-1"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={withAttachments} onChange={(e) => setWithAttachments(e.target.checked)} /> Attachments</label>
              <span className="ml-auto">{pagination.total} message{pagination.total === 1 ? '' : 's'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="checkbox" aria-label="Select all" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} />
              {checked.size > 0 && !readOnly && (
                <>
                  <span className="text-xs text-gray-500">{checked.size} selected</span>
                  {folder === 'trash' ? (
                    <>
                      <button onClick={() => act([...checked], 'restore')} className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Restore</button>
                      <button onClick={() => act([...checked], 'purge')} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Delete forever</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => act([...checked], 'read')} className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Mark read</button>
                      <button onClick={() => act([...checked], 'unread')} className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Mark unread</button>
                      <button onClick={() => act([...checked], 'archive')} className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Archive</button>
                      <button onClick={() => act([...checked], 'trash')} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Trash</button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {loading ? <div className="p-6 text-sm text-gray-500">Loading…</div> : rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No messages in {title?.toLowerCase()}.</div>
            ) : rows.map((r) => (
              <div key={r.id} className={`flex gap-2 border-b border-gray-100 px-3 py-2.5 hover:bg-gray-50 ${openId === r.id ? 'bg-blue-50' : ''}`}>
                <input type="checkbox" className="mt-1" checked={checked.has(r.id)} onChange={() => toggleCheck(r.id)} aria-label="Select message" />
                <button disabled={readOnly} onClick={() => act([r.id], r.is_starred ? 'unstar' : 'star')} className="mt-0.5 disabled:opacity-60" aria-label="Star">
                  <Star className={`h-4 w-4 ${r.is_starred ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
                </button>
                <button onClick={() => openThread(r)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${r.direction === 'in' && !r.is_read ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                      {r.direction === 'in' ? (r.from_name || r.from_address) : `To: ${r.to_addresses}`}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">{formatWhen(r.message_date)}</span>
                  </div>
                  <div className={`truncate text-sm ${r.direction === 'in' && !r.is_read ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>
                    {r.subject}{r.thread_count > 1 && <span className="ml-1 text-xs text-gray-400">({r.thread_count})</span>}
                  </div>
                  <div className="truncate text-xs text-gray-500">{r.preview}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {r.has_attachments ? <Paperclip className="h-3.5 w-3.5 text-gray-400" /> : null}
                    {r.lead_name && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">Lead: {r.lead_name}</span>}
                    {r.status === 'failed' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Failed</span>}
                  </div>
                </button>
              </div>
            ))}
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button>
              <span>Page {page} of {pagination.totalPages}</span>
              <button disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
            </div>
          )}
        </section>

        {/* Reading pane */}
        <section className="rounded-lg bg-white p-4 shadow lg:col-span-6">
          {!thread.length ? <div className="p-6 text-sm text-gray-500">Select a message to read it.</div> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold text-gray-900">{thread[0].subject}</h2>
                {!readOnly && last && (
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => startReply(last, false)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-100"><Reply className="h-3.5 w-3.5" /> Reply</button>
                    <button onClick={() => startReply(last, true)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-100"><ReplyAll className="h-3.5 w-3.5" /> Reply all</button>
                    <button onClick={() => startForward(last)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-100"><Forward className="h-3.5 w-3.5" /> Forward</button>
                    <button onClick={() => act(thread.map((t) => t.id), 'unread')} title="Mark unread" className="rounded-lg bg-gray-100 p-1.5 hover:bg-gray-200"><MailIcon className="h-3.5 w-3.5" /></button>
                    {last.folder === 'trash' || last.folder === 'archive' ? (
                      <button onClick={() => act(thread.map((t) => t.id), 'restore')} title="Move back" className="rounded-lg bg-gray-100 p-1.5 hover:bg-gray-200"><RotateCcw className="h-3.5 w-3.5" /></button>
                    ) : (
                      <>
                        <button onClick={() => act(thread.map((t) => t.id), 'archive')} title="Archive" className="rounded-lg bg-gray-100 p-1.5 hover:bg-gray-200"><Archive className="h-3.5 w-3.5" /></button>
                        <button onClick={() => act(thread.map((t) => t.id), 'trash')} title="Move to trash" className="rounded-lg bg-red-50 p-1.5 text-red-700 hover:bg-red-100"><Trash2 className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {!readOnly && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {last?.lead_id ? (
                    <>
                      <a className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700 underline" href={`/admin/leads/${last.lead_id}`}><Link2 className="h-3 w-3" /> {last.lead_name}</a>
                      <button onClick={() => act(thread.map((t) => t.id), 'unlink')} className="text-gray-500 underline">Unlink</button>
                    </>
                  ) : (
                    <>
                      <input value={leadQuery} onChange={(e) => setLeadQuery(e.target.value)} placeholder="Link to a lead (name, email, phone, ID)…" className="w-72 rounded-lg border border-gray-300 px-2.5 py-1.5" />
                      {leadResults.map((l) => (
                        <button key={l.id} onClick={() => { act(thread.map((t) => t.id), 'link', { leadId: l.id }); setLeadQuery(''); setLeadResults([]); }} className="rounded-full bg-gray-100 px-2.5 py-1 hover:bg-gray-200">#{l.id} {l.name}</button>
                      ))}
                    </>
                  )}
                </div>
              )}

              {thread.map((m, idx) => (
                <article key={m.id} className={`rounded-lg border p-3 ${m.direction === 'out' ? 'border-blue-100 bg-blue-50/40' : 'border-gray-200'}`}>
                  <div className="mb-2 text-xs text-gray-500">
                    <span className="font-medium text-gray-800">{m.direction === 'out' ? 'You' : (m.from_name || m.from_address)}</span>
                    {' '}&lt;{m.from_address}&gt; → {m.to_addresses}{m.cc_addresses ? ` · Cc ${m.cc_addresses}` : ''} · {new Date(m.message_date).toLocaleString()}
                  </div>
                  {m.error && <div className="mb-2 text-sm text-red-600">Send failed: {m.error}</div>}
                  {m.body_html && m.direction === 'in' && showHtml ? <HtmlBody html={m.body_html} /> : <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">{m.body_text || '(no text content)'}</pre>}
                  {m.attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {m.attachments.map((a) => (
                        <a key={a.id} href={`/api/mail/attachments/${a.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                          <Paperclip className="h-3.5 w-3.5" /> {a.filename} <span className="text-gray-400">{formatSize(a.size)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {idx === thread.length - 1 && m.body_html && m.direction === 'in' && (
                    <button onClick={() => setShowHtml((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 underline"><MailOpen className="h-3 w-3" /> {showHtml ? 'Show as plain text' : 'Show formatted'}</button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {compose && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{compose.inReplyTo ? 'Reply' : 'New message'}</h3>
              <button onClick={closeCompose} aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex items-center gap-2">
              <input className={field} placeholder="To (comma separated)" value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} />
              {!showCcBcc && <button onClick={() => setShowCcBcc(true)} className="shrink-0 text-xs text-blue-600 underline">Cc/Bcc</button>}
            </div>
            {showCcBcc && (
              <>
                <input className={field} placeholder="Cc" value={compose.cc} onChange={(e) => setCompose({ ...compose, cc: e.target.value })} />
                <input className={field} placeholder="Bcc" value={compose.bcc} onChange={(e) => setCompose({ ...compose, bcc: e.target.value })} />
              </>
            )}
            <input className={field} placeholder="Subject" value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} />
            <textarea className={field} rows={10} placeholder="Message" value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} />
            {compose.leadId && <div className="text-xs text-indigo-700">This email will be linked to lead #{compose.leadId}{compose.leadName ? ` (${compose.leadName})` : ''}.</div>}
            {compose.files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {compose.files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs">
                    <Paperclip className="h-3 w-3" /> {f.name} <span className="text-gray-400">{formatSize(f.size)}</span>
                    <button onClick={() => setCompose({ ...compose, files: compose.files.filter((_, j) => j !== i) })} aria-label="Remove"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <div>
                <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                <button onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"><Paperclip className="h-4 w-4" /> Attach</button>
                <span className="ml-2 text-xs text-gray-400">max 4 MB total</span>
              </div>
              <div className="flex gap-3">
                <button onClick={closeCompose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
                <button onClick={send} disabled={sending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400">{sending ? 'Sending…' : 'Send'}</button>
              </div>
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
