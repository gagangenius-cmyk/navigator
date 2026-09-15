'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, Info, Tag } from 'lucide-react';
import { RecordCard, RecordList } from '@/components/shared/ResponsiveRecordList';
import { useAuth } from '@/contexts/AuthContext';
import { isCeo } from '@/lib/roleChecks';

interface LeadStatus {
  id: number;
  name: string;
  badge_class: string;
  kanban_accent_class: string;
  kanban_tint_class: string;
  uses_p_priority_scale: number;
  is_enabled: number;
  sort_order: number;
}

const emptyForm = {
  name: '',
  badge_class: 'bg-gray-100 text-gray-800',
  kanban_accent_class: 'bg-slate-400',
  kanban_tint_class: 'border-slate-200 bg-slate-50/70',
  uses_p_priority_scale: 0,
  is_enabled: 1,
  sort_order: 0,
};

export default function LeadStatusesPage() {
  const { user } = useAuth();
  const canDelete = isCeo(user as any);
  const [rows, setRows] = useState<LeadStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<typeof emptyForm>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/lead-statuses');
      const data = await res.json();
      setRows(data.data ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.name.trim()) { setMsg('Name is required'); return; }
    setSaving(true); setMsg('');
    try {
      const url = editId ? `/api/admin/lead-statuses/${editId}` : '/api/admin/lead-statuses';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || 'Failed to save'); return; }
      setMsg(editId ? 'Status updated.' : 'Status added.');
      setShowAdd(false); setEditId(null); setForm({ ...emptyForm });
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this status? Leads currently holding it will keep the text value, but it will disappear from the dropdown.')) return;
    await fetch(`/api/admin/lead-statuses/${id}`, { method: 'DELETE' });
    load();
  };

  const startEdit = (s: LeadStatus) => {
    setForm({
      name: s.name,
      badge_class: s.badge_class,
      kanban_accent_class: s.kanban_accent_class,
      kanban_tint_class: s.kanban_tint_class,
      uses_p_priority_scale: s.uses_p_priority_scale,
      is_enabled: s.is_enabled,
      sort_order: s.sort_order,
    });
    setEditId(s.id);
    setShowAdd(true);
  };

  const cancelForm = () => { setShowAdd(false); setEditId(null); setForm({ ...emptyForm }); setMsg(''); };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Lead Statuses</h1>
          <p className="text-sm text-gray-500">
            The disposition options agents pick from when updating a lead&apos;s status — drives every
            status dropdown, filter, badge color, and Kanban column in the app. &lsquo;untouched&rsquo;
            and &lsquo;New&rsquo; are system-managed lifecycle states and aren&apos;t listed here.
          </p>
        </div>
        <button onClick={() => { setShowAdd(true); setEditId(null); setForm({ ...emptyForm }); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Add Status
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Colors are Tailwind class strings (e.g. <code>bg-red-100 text-red-800</code> for the badge).
          &ldquo;Uses P1-P4 priority scale&rdquo; switches the Priority field to P1/P2/P3/P4 instead of
          High/Medium/Low whenever a lead has this status — currently only meaningful for one status at a time.
        </span>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-sm ${msg.includes('required') || msg.includes('Failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{msg}</div>
      )}

      {showAdd && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
          <h3 className="font-medium text-gray-900">{editId ? 'Edit Status' : 'Add Status'}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Name *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Hot"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Badge Classes</label>
              <input value={form.badge_class} onChange={e => setForm(p => ({ ...p, badge_class: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Kanban Accent Class</label>
              <input value={form.kanban_accent_class} onChange={e => setForm(p => ({ ...p, kanban_accent_class: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Kanban Tint Classes</label>
              <input value={form.kanban_tint_class} onChange={e => setForm(p => ({ ...p, kanban_tint_class: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Sort Order</label>
              <input type="number" value={form.sort_order} onChange={e => setForm(p => ({ ...p, sort_order: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="uses_p" checked={form.uses_p_priority_scale === 1}
                onChange={e => setForm(p => ({ ...p, uses_p_priority_scale: e.target.checked ? 1 : 0 }))}
                className="rounded" />
              <label htmlFor="uses_p" className="text-sm text-gray-700">Uses P1-P4 priority scale</label>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="is_enabled" checked={form.is_enabled === 1}
                onChange={e => setForm(p => ({ ...p, is_enabled: e.target.checked ? 1 : 0 }))}
                className="rounded" />
              <label htmlFor="is_enabled" className="text-sm text-gray-700">Enabled (shown in dropdown)</label>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
              <Check className="h-4 w-4" /> {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={cancelForm}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <RecordList
          loading={loading}
          isEmpty={!loading && rows.length === 0}
          emptyIcon={Tag}
          emptyTitle="No statuses configured."
        >
          {rows.map(s => (
            <RecordCard
              key={s.id}
              avatar={<Tag className="h-4 w-4" />}
              avatarColorClass="from-blue-600 to-cyan-400"
              title={
                <span className="min-w-0 break-words text-sm font-bold text-gray-950">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.badge_class}`}>{s.name}</span>
                </span>
              }
              titleBadges={
                <>
                  {s.uses_p_priority_scale === 1 && (
                    <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">P1-P4 scale</span>
                  )}
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {s.is_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </>
              }
              stats={[
                { label: 'Sort', value: String(s.sort_order) },
                { label: 'Kanban Accent', value: s.kanban_accent_class },
                { label: 'Kanban Tint', value: s.kanban_tint_class },
              ]}
              actions={[
                { key: 'edit', icon: Edit2, label: 'Edit', onClick: () => startEdit(s) },
                { key: 'delete', icon: Trash2, label: 'Delete', onClick: () => handleDelete(s.id), colorClass: 'bg-red-50 text-red-700 hover:bg-red-100', hidden: !canDelete },
              ]}
            />
          ))}
        </RecordList>
      </div>
    </div>
  );
}
