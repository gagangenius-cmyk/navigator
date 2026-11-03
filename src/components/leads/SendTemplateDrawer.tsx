'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Mail, Loader2, CheckCircle, AlertTriangle, Clock } from 'lucide-react';

interface TemplateOption { id: number; name: string; category: string | null }
interface PreviewResponse {
  success: boolean;
  error?: string;
  willSend: number;
  skippedTotal: number;
  skipped: { reason: string; label: string; count: number }[];
  perSender: { name: string; email: string; count: number }[];
  skippedLeads: { leadId: number; leadName: string; reason: string }[];
  variables: string[];
  rendered: { subject: string; html: string; missing: string[]; leadName: string; to: string | null; from: string | null } | null;
}
interface JobResponse {
  success: boolean;
  job?: { status: string; total_queued: number; sent: string | number; failed: string | number; pending: string | number };
  problems?: { lead_id: number; to_email: string | null; status: string; reason: string | null }[];
}

interface Props {
  open: boolean;
  leadIds: number[];
  onClose: () => void;
  onQueued: () => void;
}

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function SendTemplateDrawer({ open, leadIds, onClose, onQueued }: Props) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [canSendAsOwner, setCanSendAsOwner] = useState(false);
  const [canInstallStarters, setCanInstallStarters] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [senderMode, setSenderMode] = useState<'me' | 'owner'>('me');
  const [scheduledAt, setScheduledAt] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  // One key per drawer session: a double-clicked Send returns the job already created.
  const idempotencyKey = useRef(newKey());

  const loadTemplates = useCallback(() => {
    setLoadingTemplates(true);
    return fetch('/api/template-sends/templates')
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || 'Could not load templates');
        setTemplates(data.templates || []);
        setCanSendAsOwner(Boolean(data.canSendAsOwner));
        setCanInstallStarters(Boolean(data.canInstallStarters));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load templates'))
      .finally(() => setLoadingTemplates(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    idempotencyKey.current = newKey();
    setTemplateId(''); setPreview(null); setError(''); setJobId(null); setJob(null); setScheduledAt('');
    void loadTemplates();
  }, [open, loadTemplates]);

  // Templates live in the database (Broadcast Center → Templates). This adds the ready-made
  // appointment / follow-up / payment-reminder set to it, once; existing ones are never duplicated.
  const installStarters = async () => {
    setInstalling(true); setError('');
    try {
      const res = await fetch('/api/broadcast/templates/starters', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not install the starter templates');
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not install the starter templates');
    } finally {
      setInstalling(false);
    }
  };

  const loadPreview = useCallback(async () => {
    if (!templateId) { setPreview(null); return; }
    setPreviewing(true); setError('');
    try {
      const res = await fetch('/api/template-sends/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, leadIds, senderMode }),
      });
      const data: PreviewResponse = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Preview failed');
      setPreview(data);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }, [templateId, leadIds, senderMode]);

  useEffect(() => { if (open) void loadPreview(); }, [open, loadPreview]);

  // Follow the job's progress after queuing.
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/template-sends/${jobId}`);
        const data: JobResponse = await res.json();
        if (!stop && data.success) {
          setJob(data);
          if (data.job && ['completed', 'cancelled'].includes(data.job.status)) return;
        }
      } catch { /* keep polling */ }
      if (!stop) setTimeout(poll, 3000);
    };
    void poll();
    return () => { stop = true; };
  }, [jobId]);

  const send = async () => {
    if (!templateId || !preview?.willSend) return;
    setSending(true); setError('');
    try {
      const res = await fetch('/api/template-sends', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId, leadIds, senderMode,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not queue the send');
      setJobId(Number(data.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not queue the send');
    } finally {
      setSending(false);
    }
  };

  const progress = useMemo(() => {
    const j = job?.job;
    if (!j) return null;
    return { sent: Number(j.sent || 0), failed: Number(j.failed || 0), pending: Number(j.pending || 0), total: Number(j.total_queued || 0), status: j.status };
  }, [job]);

  if (!open) return null;
  const done = progress && ['completed', 'cancelled'].includes(progress.status);

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={() => !sending && (jobId ? onQueued() : onClose())}>
      <aside className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-emerald-600" />
            <h2 className="text-base font-semibold text-gray-900">Send template</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{leadIds.length} selected</span>
          </div>
          <button onClick={() => (jobId ? onQueued() : onClose())} className="rounded-md p-1 text-gray-500 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {error && <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

          {!jobId && (
            <>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Template</span>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : '')} disabled={loadingTemplates}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                  <option value="">{loadingTemplates ? 'Loading…' : templates.length ? 'Choose a template…' : 'No sendable email templates'}</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {!loadingTemplates && !templates.length && (
                  <span className="mt-1 block text-xs text-gray-500">
                    Only approved email templates in a service category (Appointment, Follow-up, Payment reminder, Service update) can be sent from here. Templates are managed in Broadcast Center → Templates.
                    {canInstallStarters && (
                      <button type="button" onClick={installStarters} disabled={installing} className="ml-1 font-semibold text-emerald-700 underline disabled:opacity-50">
                        {installing ? 'Installing…' : 'Install the starter templates'}
                      </button>
                    )}
                  </span>
                )}
              </label>

              {canSendAsOwner && (
                <fieldset>
                  <legend className="mb-1 text-sm font-medium text-gray-700">Send from</legend>
                  <div className="flex gap-4 text-sm text-gray-700">
                    <label className="flex items-center gap-2"><input type="radio" checked={senderMode === 'me'} onChange={() => setSenderMode('me')} /> My mailbox</label>
                    <label className="flex items-center gap-2"><input type="radio" checked={senderMode === 'owner'} onChange={() => setSenderMode('owner')} /> Each lead&apos;s counsellor</label>
                  </div>
                </fieldset>
              )}

              {previewing && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Preparing preview…</div>}

              {preview && !previewing && (
                <>
                  <section className="rounded-lg border border-gray-200">
                    <div className="border-b bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Preview{preview.rendered ? ` · ${preview.rendered.leadName}` : ''}</div>
                    {preview.rendered ? (
                      <div className="space-y-2 p-3">
                        <div className="text-xs text-gray-500">
                          <div><span className="font-medium text-gray-700">From:</span> {preview.rendered.from || '—'}</div>
                          <div><span className="font-medium text-gray-700">To:</span> {preview.rendered.to || '—'}</div>
                        </div>
                        <div className="text-sm font-semibold text-gray-900">{preview.rendered.subject || <span className="text-red-600">(no subject)</span>}</div>
                        {/* Sandboxed: the template HTML must never run scripts in the CRM origin. */}
                        <iframe title="Email preview" sandbox="" srcDoc={preview.rendered.html} className="h-72 w-full rounded border border-gray-200 bg-white" />
                        {preview.rendered.missing.length > 0 && (
                          <div className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                            Empty for this lead (will be blank in the email): {preview.rendered.missing.join(', ')}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 text-sm text-gray-500">None of the selected leads can be emailed, so there is nothing to preview.</div>
                    )}
                  </section>

                  <section className="rounded-lg border border-gray-200 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium text-gray-900"><CheckCircle className="h-4 w-4 text-emerald-600" /> {preview.willSend} will be sent</div>
                    {preview.perSender.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                        {preview.perSender.map((s) => <li key={s.email}>{s.count} from {s.name} ({s.email})</li>)}
                      </ul>
                    )}
                    {preview.skippedTotal > 0 && (
                      <div className="mt-3 border-t pt-2">
                        <div className="font-medium text-amber-700">{preview.skippedTotal} skipped</div>
                        <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                          {preview.skipped.map((s) => <li key={s.reason}>{s.count} · {s.label}</li>)}
                        </ul>
                      </div>
                    )}
                  </section>

                  <label className="block">
                    <span className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700"><Clock className="h-4 w-4" /> Schedule (optional)</span>
                    <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                    <span className="mt-1 block text-xs text-gray-500">Leave empty to send now. Uses your device&apos;s time zone.</span>
                  </label>
                </>
              )}
            </>
          )}

          {jobId && (
            <section className="rounded-lg border border-gray-200 p-4 text-sm">
              {!progress && <div className="flex items-center gap-2 text-gray-600"><Loader2 className="h-4 w-4 animate-spin" /> Queued…</div>}
              {progress && (
                <>
                  <div className="flex items-center gap-2 font-medium text-gray-900">
                    {done ? <CheckCircle className="h-5 w-5 text-emerald-600" /> : progress.status === 'scheduled' ? <Clock className="h-5 w-5 text-blue-600" /> : <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />}
                    {done ? 'Finished' : progress.status === 'scheduled' ? 'Scheduled' : 'Sending…'}
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress.total ? Math.round(((progress.sent + progress.failed) / progress.total) * 100) : 0}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-gray-600">{progress.sent} sent · {progress.failed} failed · {progress.pending} waiting</div>
                  {job?.problems && job.problems.length > 0 && (
                    <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t pt-2 text-xs text-gray-600">
                      {job.problems.map((p, i) => <li key={i}>Lead #{p.lead_id}{p.to_email ? ` (${p.to_email})` : ''}: {p.reason || p.status}</li>)}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
          {!jobId ? (
            <>
              <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={send} disabled={sending || !templateId || !preview?.willSend}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                {scheduledAt ? 'Schedule' : 'Send'} {preview?.willSend ? `to ${preview.willSend}` : ''}
              </button>
            </>
          ) : (
            <button onClick={onQueued} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">Done</button>
          )}
        </footer>
      </aside>
    </div>
  );
}
