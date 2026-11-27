'use client';

import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { dubaiNow, dubaiToday } from '@/lib/dubaiDate';
import { useLeadStatuses } from '@/hooks/useLeadStatuses';

export interface RescheduleTarget {
  id: number;
  leadId?: number;
  leadStatus?: string;
  leadName: string;
  phone?: string;
  reminder_date: string;
  message: string;
  priority: string;
}

// Rescheduling closes the previous follow-up with a lead remark about what happened and opens a new one.
export default function RescheduleFollowUpModal({ followUp, onClose, onSaved }: {
  followUp: RescheduleTarget;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [remark, setRemark] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState(followUp.priority || 'medium');
  const [nextNote, setNextNote] = useState('');
  const currentStatus = followUp.leadStatus || 'New';
  const [leadStatus, setLeadStatus] = useState(currentStatus);
  const { statuses } = useLeadStatuses();
  // Older leads can hold a status that is not in the admin list - keep it selectable so it is not silently replaced.
  const statusOptions = Array.from(new Set([currentStatus, 'New', ...statuses.map((s) => s.name)]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Stored follow-up times are already UAE wall clock - show them as stored.
  const previous = String(followUp.reminder_date).replace('T', ' ').slice(0, 16);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!remark.trim()) return setError('Add a lead remark about the previous follow-up.');
    if (!date || !time) return setError('Select the new follow-up date and time.');
    if (`${date} ${time}:00` <= dubaiNow()) return setError('The new follow-up must be in the future (UAE time).');
    setSaving(true);
    setError('');
    let statusSaved = false;
    try {
      // Status goes first, through the normal lead update (permissions, approval gate, history): if it is refused,
      // nothing else changes.
      if (followUp.leadId && leadStatus !== currentStatus) {
        const statusRes = await fetch(`/api/leads/${followUp.leadId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: leadStatus }),
        });
        if (!statusRes.ok) throw new Error((await statusRes.json().catch(() => ({}))).error || 'Failed to change lead status');
        statusSaved = true;
      }
      const res = await fetch('/api/follow-up-reminders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reminderId: followUp.id,
          action: 'reschedule',
          notes: remark.trim(),
          rescheduledAt: `${date}T${time}:00`,
          priority,
          nextNote: nextNote.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to reschedule');
      window.toast.success(statusSaved ? 'Follow-up rescheduled, lead remark and status saved' : 'Follow-up rescheduled and lead remark saved');
      await onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reschedule';
      setError(statusSaved ? `Lead status was changed, but the follow-up was not rescheduled: ${message}` : message);
      setSaving(false);
    }
  };

  const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500';
  const label = 'mb-1 block text-sm font-medium text-gray-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
      <form onSubmit={save} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
          <div>
            <h2 id="reschedule-title" className="text-lg font-semibold text-gray-900">Reschedule follow-up</h2>
            <p className="text-sm text-gray-500">{followUp.leadName}{followUp.phone ? ` · ${followUp.phone}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Previous follow-up · {previous}</div>
            <div className="mt-1 whitespace-pre-wrap text-gray-800">{followUp.message || '—'}</div>
          </div>

          <div>
            <label className={label} htmlFor="rs-remark">Lead remark about the previous follow-up *</label>
            <textarea id="rs-remark" autoFocus required rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="What happened? e.g. Client did not pick up, asked to call next week" className={field} />
          </div>

          {followUp.leadId ? (
            <div>
              <label className={label} htmlFor="rs-lead-status">Lead status</label>
              <select id="rs-lead-status" value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)} className={field}>
                {statusOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="rs-date">New date (UAE) *</label>
              <input id="rs-date" type="date" required min={dubaiToday()} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="rs-time">New time (UAE) *</label>
              <input id="rs-time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={field} />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="rs-priority">Priority</label>
            <select id="rs-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          <div>
            <label className={label} htmlFor="rs-note">Note for the new follow-up (optional)</label>
            <textarea id="rs-note" rows={2} value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="Leave blank to keep the previous message" className={field} />
          </div>

          {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 p-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
            {saving ? 'Saving…' : 'Save & schedule'}
          </button>
        </div>
      </form>
    </div>
  );
}
