'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, Info, Gauge } from 'lucide-react';
import { RecordCard, RecordList } from '@/components/shared/ResponsiveRecordList';
import { useAuth } from '@/contexts/AuthContext';
import { isCeo } from '@/lib/roleChecks';

interface QualityMapping {
  id: number;
  quality_label: string;
  meta_event_name: string;
  meta_value: number | string | null;
  meta_currency: string | null;
  is_enabled: number;
  sort_order: number;
}

const emptyForm = {
  quality_label: '',
  meta_event_name: '',
  meta_value: '',
  meta_currency: '',
  is_enabled: 1,
  sort_order: 0,
};

export default function MetaQualityMappingsPage() {
  const { user } = useAuth();
  const canDelete = isCeo(user as any);
  const [rows, setRows] = useState<QualityMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<typeof emptyForm>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/meta-leads/quality-mappings');
      const data = await res.json();
      setRows(data.data ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.quality_label.trim() || !form.meta_event_name.trim()) {
      setMsg('Quality label and Meta event name are required'); return;
    }
    setSaving(true); setMsg('');
    try {
      const url = editId ? `/api/admin/meta-leads/quality-mappings/${editId}` : '/api/admin/meta-leads/quality-mappings';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          meta_value: form.meta_value === '' ? null : Number(form.meta_value),
          meta_currency: form.meta_currency || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || 'Failed to save'); return; }
      setMsg(editId ? 'Mapping updated.' : 'Mapping added.');
      setShowAdd(false); setEditId(null); setForm({ ...emptyForm });
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this quality option? Any agent picking it will no longer notify Meta.')) return;
    await fetch(`/api/admin/meta-leads/quality-mappings/${id}`, { method: 'DELETE' });
    load();
  };

  const startEdit = (m: QualityMapping) => {
    setForm({
      quality_label: m.quality_label,
      meta_event_name: m.meta_event_name,
      meta_value: m.meta_value != null ? String(m.meta_value) : '',
      meta_currency: m.meta_currency || '',
      is_enabled: m.is_enabled,
      sort_order: m.sort_order,
    });
    setEditId(m.id);
    setShowAdd(true);
  };

  const cancelForm = () => { setShowAdd(false); setEditId(null); setForm({ ...emptyForm }); setMsg(''); };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Lead Quality Feedback</h1>
          <p className="text-sm text-gray-500">
            Defines the &ldquo;Meta Lead Quality&rdquo; dropdown agents use when updating a lead&apos;s status.
            Each option reports back to Meta&apos;s Conversions API for leads that came from Meta Lead Ads.
          </p>
        </div>
        <button onClick={() => { setShowAdd(true); setEditId(null); setForm({ ...emptyForm }); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Add Option
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Verify <strong>Meta Event Name</strong> against your own Meta Events Manager &rarr; Data Sources &rarr; Lead
          source &rarr; Lead Status setup — the exact event names Meta recognizes for optimization can vary by
          account. Leads without a captured Facebook lead ID are skipped automatically.
        </span>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-sm ${msg.includes('required') || msg.includes('Failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{msg}</div>
      )}

      {showAdd && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
          <h3 className="font-medium text-gray-900">{editId ? 'Edit Option' : 'Add Option'}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Quality Label *</label>
              <input value={form.quality_label} onChange={e => setForm(p => ({ ...p, quality_label: e.target.value }))}
                placeholder="e.g. Qualified"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Meta Event Name *</label>
              <input value={form.meta_event_name} onChange={e => setForm(p => ({ ...p, meta_event_name: e.target.value }))}
                placeholder="e.g. Purchase, Contact, Qualified Lead"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Value (optional)</label>
              <input type="number" value={form.meta_value} onChange={e => setForm(p => ({ ...p, meta_value: e.target.value }))}
                placeholder="For value-based optimization"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Currency</label>
              <input value={form.meta_currency} onChange={e => setForm(p => ({ ...p, meta_currency: e.target.value }))}
                placeholder="AED"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Sort Order</label>
              <input type="number" value={form.sort_order} onChange={e => setForm(p => ({ ...p, sort_order: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
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
          emptyIcon={Gauge}
          emptyTitle="No quality options. Add one above."
        >
          {rows.map(m => (
            <RecordCard
              key={m.id}
              avatar={<Gauge className="h-4 w-4" />}
              avatarColorClass="from-blue-600 to-cyan-400"
              title={<span className="min-w-0 break-words font-mono text-sm font-bold text-gray-950">{m.quality_label} → <span className="text-blue-700">{m.meta_event_name}</span></span>}
              titleBadges={
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${m.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {m.is_enabled ? 'Enabled' : 'Disabled'}
                </span>
              }
              stats={[
                { label: 'Value', value: m.meta_value != null ? String(m.meta_value) : '—' },
                { label: 'Currency', value: m.meta_currency || '—' },
                { label: 'Sort', value: String(m.sort_order) },
              ]}
              actions={[
                { key: 'edit', icon: Edit2, label: 'Edit', onClick: () => startEdit(m) },
                { key: 'delete', icon: Trash2, label: 'Delete', onClick: () => handleDelete(m.id), colorClass: 'bg-red-50 text-red-700 hover:bg-red-100', hidden: !canDelete },
              ]}
            />
          ))}
        </RecordList>
      </div>
    </div>
  );
}
