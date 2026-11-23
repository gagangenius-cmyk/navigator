'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, Layers } from 'lucide-react';
import { RecordCard, RecordList } from '@/components/shared/ResponsiveRecordList';
import { useAuth } from '@/contexts/AuthContext';
import { isCeo } from '@/lib/roleChecks';

interface LeadType {
  id: number;
  name: string;
  description: string | null;
  is_enabled: number;
  sort_order: number;
  lead_count: number;
}

const emptyForm = { name: '', description: '', is_enabled: 1, sort_order: 0 };

export default function LeadTypesPage() {
  const { user } = useAuth();
  const canDelete = isCeo(user as never);
  const [rows, setRows] = useState<LeadType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/lead-types');
      const data = await res.json();
      setRows(data.data ?? []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cancel = () => { setShowForm(false); setEditId(null); setForm({ ...emptyForm }); };

  const save = async () => {
    if (!form.name.trim()) { setMsg({ ok: false, text: 'Name is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(editId ? `/api/admin/lead-types/${editId}` : '/api/admin/lead-types', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: d.error || 'Failed to save' }); return; }
      setMsg({ ok: true, text: editId ? 'Lead type updated.' : 'Lead type added.' });
      cancel();
      load();
    } finally { setSaving(false); }
  };

  const remove = async (t: LeadType) => {
    if (!confirm(`Delete lead type "${t.name}"?`)) return;
    const res = await fetch(`/api/admin/lead-types/${t.id}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: 'Lead type deleted.' } : { ok: false, text: d.error || 'Failed to delete' });
    load();
  };

  const toggle = async (t: LeadType) => {
    await fetch(`/api/admin/lead-types/${t.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: t.is_enabled ? 0 : 1 }),
    });
    load();
  };

  const startEdit = (t: LeadType) => {
    setForm({ name: t.name, description: t.description || '', is_enabled: t.is_enabled, sort_order: t.sort_order });
    setEditId(t.id);
    setShowForm(true);
    setMsg(null);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Lead Types</h1>
          <p className="text-sm text-gray-500">
            The Lead Type options agents choose when adding or editing a lead. Drives the Lead Type dropdown and the filter on the Leads page.
            Renaming a type updates the leads that already use it.
          </p>
        </div>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ ...emptyForm }); setMsg(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Add Lead Type
        </button>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>
      )}

      {showForm && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
          <h3 className="font-medium text-gray-900">{editId ? 'Edit Lead Type' : 'Add Lead Type'}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">Name *</label>
              <input value={form.name} maxLength={100} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Individual"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Sort Order</label>
              <input type="number" value={form.sort_order} onChange={(e) => setForm((p) => ({ ...p, sort_order: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="lt_enabled" checked={form.is_enabled === 1}
                onChange={(e) => setForm((p) => ({ ...p, is_enabled: e.target.checked ? 1 : 0 }))} className="rounded" />
              <label htmlFor="lt_enabled" className="text-sm text-gray-700">Enabled</label>
            </div>
            <div className="sm:col-span-4">
              <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
              <input value={form.description} maxLength={255} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Optional - what this type means"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
              <Check className="h-4 w-4" /> {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={cancel}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <RecordList loading={loading} isEmpty={!loading && rows.length === 0} emptyIcon={Layers} emptyTitle="No lead types configured.">
          {rows.map((t) => (
            <RecordCard
              key={t.id}
              avatar={<Layers className="h-4 w-4" />}
              avatarColorClass="from-blue-600 to-cyan-400"
              title={<span className="min-w-0 break-words text-sm font-bold text-gray-950">{t.name}</span>}
              titleBadges={
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${t.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {t.is_enabled ? 'Enabled' : 'Disabled'}
                </span>
              }
              stats={[
                { label: 'Leads', value: String(t.lead_count) },
                { label: 'Sort', value: String(t.sort_order) },
                ...(t.description ? [{ label: 'Description', value: t.description }] : []),
              ]}
              actions={[
                { key: 'toggle', icon: t.is_enabled ? X : Check, label: t.is_enabled ? 'Disable' : 'Enable', onClick: () => toggle(t) },
                { key: 'edit', icon: Edit2, label: 'Edit', onClick: () => startEdit(t) },
                { key: 'delete', icon: Trash2, label: 'Delete', onClick: () => remove(t), colorClass: 'bg-red-50 text-red-700 hover:bg-red-100', hidden: !canDelete },
              ]}
            />
          ))}
        </RecordList>
      </div>
    </div>
  );
}
