'use client';

import { formatDubaiDateTime } from '@/lib/dubaiDate';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadStatuses } from '@/hooks/useLeadStatuses';
import { isBranchManagerOrCeo } from '@/lib/roleChecks';
import { AlertCircle, ChevronRight, Save, Target, RefreshCw } from 'lucide-react';
import { activityLabel } from '@/lib/activityLabels';

// Stage Components
export default function ProspectStage({ lead, data, setData, onLeadUpdated, onSaveProspect, onNext, feeData, feeLoading, paymentType, setPaymentType, getFeePackageTotals }: any) {
  const { user } = useAuth();
  const { statuses: leadStatuses } = useLeadStatuses();
  // Same rule as the Edit Lead page and the PUT /api/leads/[id] server-side
  // check: once a lead is in the CRM, only Branch Manager/CEO may change its
  // contact details. This workspace previously let anyone edit email/mobile/
  // phone here regardless of role — the save would silently 403 for a
  // counselor since the server already enforces this, so disable it in the UI too.
  const canEditContactInfo = isBranchManagerOrCeo(user as any);
  const [saving, setSaving] = useState(false);
  const [editingLeadField, setEditingLeadField] = useState<string | null>(null);
  const [leadDraft, setLeadDraft] = useState<Record<string, any>>({});
  const [programs, setPrograms] = useState<Array<{ id: number | string; name: string; validity?: string | null }>>([]);
  const [countries, setCountries] = useState<Array<{ id: number; name: string }>>([]);
  const REMARKS_PAGE_SIZE = 5;
  const [remarksLog, setRemarksLog] = useState<Array<{ id: number; action: string; remark: string; actorName?: string; created_at: string }>>([]);
  const [remarksTotal, setRemarksTotal] = useState(0);
  const [loadingRemarks, setLoadingRemarks] = useState(false);
  const [loadingMoreRemarks, setLoadingMoreRemarks] = useState(false);

  useEffect(() => {
    if (lead) setLeadDraft(lead);
  }, [lead]);

  // The opportunity's service is just whatever's set as "Service interest" in
  // the Counselor workspace above — there's no separate program picker for
  // it anymore, so keep it synced here instead (including when the workspace
  // field is edited after the initial load, which the one-time hydration on
  // fetch wouldn't otherwise pick up).
  useEffect(() => {
    const currentServiceId = leadDraft.service_interest ?? lead?.service_interest ?? '';
    if (!currentServiceId) return;
    const currentServiceName = lead?.service_interest_label
      || programs.find((p) => String(p.id) === String(currentServiceId))?.name
      || String(currentServiceId);
    if (String(data.serviceId) === String(currentServiceId) && data.serviceRequired === currentServiceName) return;
    setData((prev: any) => ({ ...prev, serviceRequired: currentServiceName, serviceId: String(currentServiceId) }));
  }, [leadDraft.service_interest, lead?.service_interest_label, programs]);

  // Replaces the free-text opportunity "Description" box — shows the lead's
  // actual activity history from crm_remarks instead. Only fetches this lead's
  // remarks (sections=activityLog skips the appointments/followUps/legacy-remarks
  // queries this page doesn't use) and only the first page, to keep page load light.
  useEffect(() => {
    if (!lead?.id) return;
    let cancelled = false;
    setLoadingRemarks(true);
    fetch(`/api/leads/${lead.id}/activity?sections=activityLog&remarksLimit=${REMARKS_PAGE_SIZE}&remarksOffset=0`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setRemarksLog(json.activityLog || []);
        setRemarksTotal(Number(json.activityLogTotal) || 0);
      })
      .catch(() => { if (!cancelled) { setRemarksLog([]); setRemarksTotal(0); } })
      .finally(() => { if (!cancelled) setLoadingRemarks(false); });
    return () => { cancelled = true; };
  }, [lead?.id]);

  const loadMoreRemarks = async () => {
    if (!lead?.id || loadingMoreRemarks) return;
    setLoadingMoreRemarks(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/activity?sections=activityLog&remarksLimit=${REMARKS_PAGE_SIZE}&remarksOffset=${remarksLog.length}`);
      const json = await res.json();
      setRemarksLog((prev) => [...prev, ...(json.activityLog || [])]);
      setRemarksTotal(Number(json.activityLogTotal) || 0);
    } catch (error) {
      console.error('Error loading more remarks:', error);
    } finally {
      setLoadingMoreRemarks(false);
    }
  };

  // Service interest is scoped to the selected country interest — e.g.
  // picking Canada should only offer Canada-based programs, same as the Add
  // Lead form's Program Country -> Program dependency. Falls back to every
  // active service when no country is selected yet.
  useEffect(() => {
    const loadPrograms = async () => {
      try {
        const countryId = leadDraft.country_interest;
        const url = countryId ? `/api/country-programs?countryId=${countryId}` : '/api/services';
        const response = await fetch(url);
        setPrograms(response.ok ? await response.json() : []);
      } catch (error) {
        console.error('Error loading programs:', error);
        setPrograms([]);
      }
    };
    loadPrograms();
  }, [leadDraft.country_interest]);

  useEffect(() => {
    fetch('/api/admin/lookup')
      .then(r => r.json())
      .then(d => setCountries(d.countries || []))
      .catch(() => {});
  }, []);

  const saveLeadField = async (field: string) => {
    if (!lead?.id) return;
    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: leadDraft[field] ?? '' }),
      });
      const updatedLead = await response.json();
      if (!response.ok) throw new Error(updatedLead.error || 'Failed to save field');
      onLeadUpdated(updatedLead);
      setEditingLeadField(null);
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : 'Failed to save field');
    }
  };

  const leadField = (field: string, label: string, type = 'text', editable = true) => {
    const editing = editable && editingLeadField === field;
    const value = leadDraft[field] ?? '';
    return (
      <div className="rounded-lg border border-gray-200 p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</label>
          {!editing && editable && (
            <button onClick={() => setEditingLeadField(field)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="flex gap-2">
            <input
              type={type}
              value={value}
              onChange={(event) => setLeadDraft((current) => ({ ...current, [field]: event.target.value }))}
              className="min-w-0 flex-1 rounded border border-blue-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button onClick={() => saveLeadField(field)} className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">Save</button>
            <button onClick={() => { setLeadDraft(lead); setEditingLeadField(null); }} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200">Cancel</button>
          </div>
        ) : (
          <p className="min-h-5 break-words text-sm text-gray-900">{value || '—'}</p>
        )}
        {!editable && (
          <p className="mt-1 text-[11px] text-gray-400">Branch Manager/CEO only</p>
        )}
      </div>
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save status and priority to lead record
      if (lead?.id && (leadDraft.status || leadDraft.priority)) {
        const leadUpdateRes = await fetch(`/api/leads/${lead.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: leadDraft.status || undefined,
            priority: leadDraft.priority || undefined,
          }),
        });
        if (!leadUpdateRes.ok) {
          const err = await leadUpdateRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save status/priority');
        }
      }
      // onSaveProspect (saveStageData) already shows its own error toast and
      // returns false - rather than throwing - on failure, so a plain
      // `await` here used to fall through to the success toast below even
      // when the save failed. Bail out the same way moveToNextStage does.
      const saved = await onSaveProspect();
      if (!saved) return;
      window.toast.success('Prospect data saved successfully.');
    } catch (error) {
      console.error('Error saving:', error);
      window.toast.error('Failed to save data');
    } finally {
      setSaving(false);
    }
  };

  // "Continue to Quotation" must actually persist the Lead Status/Priority
  // picked in Lead Progression, not just move the wizard forward — the button
  // used to call onNext directly, so a status/priority chosen here was only
  // ever saved if the person separately clicked "Save Draft" first, and the
  // lead record could silently keep its old status/priority even after the
  // wizard had moved on to Quotation.
  const handleContinueToQuotation = async () => {
    if (lead?.id) {
      try {
        await fetch(`/api/leads/${lead.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: leadDraft.status, priority: leadDraft.priority }),
        });
      } catch (error) {
        console.error('Error saving lead status/priority before continuing:', error);
        window.toast.error('Failed to save lead status/priority. Please try again.');
        return;
      }
    }
    onNext();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <Target className="mr-3 text-blue-600" size={28} />
        <div>
          <h3 className="text-2xl font-bold text-gray-900">Prospect Stage</h3>
          <p className="text-gray-600 text-sm">Identify and qualify the opportunity</p>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-blue-950">Counselor workspace</h4>
            <p className="text-sm text-blue-800">Review and correct lead details here. Each field saves immediately, so you can fix data without leaving the flow.</p>
          </div>
          <span className="rounded bg-white px-3 py-1 text-xs font-medium text-blue-700">Lead #{lead?.id || '—'}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {leadField('fname', 'First name')}
          {leadField('lname', 'Last name')}
          {leadField('email', 'Email', 'email', canEditContactInfo)}
          {leadField('mobile', 'Mobile', 'text', canEditContactInfo)}
          {leadField('phone', 'Phone', 'text', canEditContactInfo)}
          {leadField('nationality', 'Nationality')}
          {/* Country interest — dropdown */}
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Country interest</label>
              {editingLeadField !== 'country_interest' && (
                <button onClick={() => setEditingLeadField('country_interest')} className="text-xs font-medium text-blue-600 hover:text-blue-800">Edit</button>
              )}
            </div>
            {editingLeadField === 'country_interest' ? (
              <div className="flex gap-2">
                <SearchableSelect
                  value={leadDraft.country_interest ?? ''}
                  onChange={e => setLeadDraft(cur => ({ ...cur, country_interest: e.target.value }))}
                  className="min-w-0 flex-1 rounded border border-blue-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
                  autoFocus
                >
                  <option value="">Select country</option>
                  {countries.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </SearchableSelect>
                <button onClick={() => saveLeadField('country_interest')} className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">Save</button>
                <button onClick={() => { setLeadDraft(lead); setEditingLeadField(null); }} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200">Cancel</button>
              </div>
            ) : (
              <p className="min-h-5 break-words text-sm text-gray-900">
                {lead?.country_interest_label || countries.find(c => String(c.id) === String(leadDraft.country_interest))?.name || leadDraft.country_interest || '—'}
              </p>
            )}
          </div>

          {/* Service interest — dropdown */}
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Service interest</label>
              {editingLeadField !== 'service_interest' && (
                <button onClick={() => setEditingLeadField('service_interest')} className="text-xs font-medium text-blue-600 hover:text-blue-800">Edit</button>
              )}
            </div>
            {editingLeadField === 'service_interest' ? (
              <div className="flex gap-2">
                <SearchableSelect
                  value={leadDraft.service_interest ?? ''}
                  onChange={e => setLeadDraft(cur => ({ ...cur, service_interest: e.target.value }))}
                  className="min-w-0 flex-1 rounded border border-blue-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
                  autoFocus
                >
                  <option value="">Select program</option>
                  {programs.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </SearchableSelect>
                <button onClick={() => saveLeadField('service_interest')} className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">Save</button>
                <button onClick={() => { setLeadDraft(lead); setEditingLeadField(null); }} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200">Cancel</button>
              </div>
            ) : (
              <p className="min-h-5 break-words text-sm text-gray-900">
                {lead?.service_interest_label || programs.find(p => String(p.id) === String(leadDraft.service_interest))?.name || leadDraft.service_interest || '—'}
              </p>
            )}
          </div>
          {leadField('address', 'Address')}
          {leadField('market_source', 'Lead source')}
          {leadField('priority', 'Lead priority')}
          {leadField('lead_remark', 'Counselor remarks')}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4 text-sm md:grid-cols-4">
        <div><span className="block text-xs text-gray-500">Branch</span><span className="font-medium text-gray-900">{lead?.branch_name || lead?.dmBranch?.name || '—'}</span></div>
        <div><span className="block text-xs text-gray-500">Assigned counselor</span><span className="font-medium text-gray-900">{lead?.counselor_name || lead?.dmEmployeeByCoUNSILOR?.name || '—'}</span></div>
        <div><span className="block text-xs text-gray-500">Current status</span><span className="font-medium text-gray-900">{lead?.status || 'New'}</span></div>
        <div><span className="block text-xs text-gray-500">Current package value</span><span className="font-medium text-gray-900">{lead?.payTotal || '0'}</span></div>
      </div>

      {/* Mandatory Lead Status & Priority */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-5">
        <div className="mb-3">
          <h4 className="font-semibold text-amber-950">Lead Progression (Required)</h4>
          <p className="text-sm text-amber-800">Update the lead status and priority before continuing to the next stage.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Lead Status *</label>
            <SearchableSelect
              value={leadDraft.status || ''}
              onChange={(e) => setLeadDraft((prev) => ({ ...prev, status: e.target.value }))}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select status</option>
              {leadStatuses.map((s: { id: number; name: string }) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </SearchableSelect>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Lead Priority *</label>
            <SearchableSelect
              value={leadDraft.priority || ''}
              onChange={(e) => setLeadDraft((prev) => ({ ...prev, priority: e.target.value }))}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select priority</option>
              <option value="Hot">Hot - Payment Expected in a week</option>
              <option value="Warm">Warm - Discussions going on can close by Month End</option>
              <option value="Cold">Cold - Developing Interest</option>
            </SearchableSelect>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h4 className="font-semibold text-lg mb-4 text-gray-900">Opportunity Information</h4>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Opportunity Name *</label>
              <input
                type="text"
                value={data.opportunityName}
                onChange={(e) => setData({ ...data, opportunityName: e.target.value })}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter opportunity name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Opportunity Type *</label>
              <SearchableSelect
                value={data.opportunityType}
                onChange={(e) => setData({ ...data, opportunityType: e.target.value })}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="new_business">New Business</option>
                <option value="upsell">Upsell</option>
                <option value="renewal">Renewal</option>
                <option value="referral">Referral</option>
              </SearchableSelect>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Estimated Value *</label>
              <input
                type="number"
                value={data.estimatedValue}
                onChange={(e) => setData({ ...data, estimatedValue: e.target.value })}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Priority *</label>
              <SearchableSelect
                value={data.priority}
                onChange={(e) => setData({ ...data, priority: e.target.value })}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </SearchableSelect>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h4 className="font-semibold text-lg mb-4 text-gray-900">Service Requirements</h4>
          <div className="space-y-4">
            {/* Service Required dropdown removed — the program is already
                set via "Service interest" in the Counselor workspace above;
                data.serviceRequired/serviceId stay in sync with it via the
                effect above instead of a second, duplicate picker here. */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">Service Required</span>
              <p className="mt-1 text-sm text-gray-900">{data.serviceRequired || 'Set "Service interest" in the Counselor workspace above.'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Activity log</label>
              <div className="space-y-2 rounded-lg border border-gray-300 p-3">
                {loadingRemarks && <p className="text-sm text-gray-400">Loading remarks…</p>}
                {!loadingRemarks && remarksLog.length === 0 && (
                  <p className="text-sm text-gray-400">No remarks recorded for this lead yet.</p>
                )}
                {remarksLog.map((entry) => (
                  <div key={entry.id} className="rounded border border-gray-100 bg-gray-50 p-2">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span className="font-medium text-gray-700">{entry.actorName || 'System'}</span>
                      <span>{formatDubaiDateTime(entry.created_at)}</span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-purple-700">{activityLabel(entry.action)}</p>
                    <p className="mt-1 text-sm text-gray-900">{entry.remark}</p>
                  </div>
                ))}
                {!loadingRemarks && remarksLog.length < remarksTotal && (
                  <button
                    type="button"
                    onClick={loadMoreRemarks}
                    disabled={loadingMoreRemarks}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                  >
                    {loadingMoreRemarks ? 'Loading…' : `Read more (${remarksTotal - remarksLog.length} more)`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Fee Package Summary ── */}
      {feeLoading && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700 animate-pulse flex items-center gap-2">
          <RefreshCw size={16} className="animate-spin" /> Loading fee package for this service &amp; country…
        </div>
      )}

      {feeData && !feeLoading && (() => {
        const { upfrontTotal, monthlyTotal, stageTotal, premiumTotal } = getFeePackageTotals(feeData);
        const cur = feeData.currencyCode || 'AED';
        const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // A package is only a real, distinct option when crm_fee actually has
        // data for that structure — not just whenever the shared upfront/prof
        // fee rows are non-zero (otherwise stage/monthly buttons show up as
        // fake duplicates of the upfront total for the ~90% of fee records
        // that never populate a monthly or stage breakdown).
        const stageExtra = Number(feeData.firstStage) + Number(feeData.secondStage) + Number(feeData.thirdStage) + Number(feeData.forthStage) + Number(feeData.fifthStage);
        const monthlyExtra = Number(feeData.firstMonth) + Number(feeData.secondMonth) + Number(feeData.thirdMonth);

        const packages: Array<{ key: 'upfront' | 'monthly' | 'stage' | 'premium'; label: string; total: number; rows: Array<{ label: string; amount: number }> }> = ([
          {
            key: 'upfront' as const,
            label: 'Upfront Package',
            total: upfrontTotal,
            rows: [
              { label: 'Upfront Fee', amount: Number(feeData.upfront) },
            ].filter(r => r.amount > 0),
            include: upfrontTotal > 0,
          },
          {
            key: 'stage' as const,
            label: 'Stage-wise Package',
            total: stageTotal,
            rows: [
              { label: 'Stage 1', amount: Number(feeData.firstStage) },
              { label: 'Stage 2', amount: Number(feeData.secondStage) },
              { label: 'Stage 3', amount: Number(feeData.thirdStage) },
              { label: 'Stage 4', amount: Number(feeData.forthStage) },
              { label: 'Stage 5', amount: Number(feeData.fifthStage) },
            ].filter(r => r.amount > 0),
            include: stageExtra > 0,
          },
          {
            key: 'monthly' as const,
            label: 'Monthly Package',
            total: monthlyTotal,
            rows: [
              { label: 'Month 1', amount: Number(feeData.firstMonth) },
              { label: 'Month 2', amount: Number(feeData.secondMonth) },
              { label: 'Month 3', amount: Number(feeData.thirdMonth) },
            ].filter(r => r.amount > 0),
            include: monthlyExtra > 0,
          },
          {
            key: 'premium' as const,
            label: 'Premium Package (50/50)',
            total: premiumTotal,
            rows: [
              { label: 'Premium Fee 1 (50%)', amount: Number(feeData.premium_fee_1 || 0) },
              { label: 'Premium Fee 2 (50%)', amount: Number(feeData.premium_fee_2 || 0) },
            ].filter(r => r.amount > 0),
            include: premiumTotal > 0,
          },
        ] as Array<{ key: 'upfront' | 'monthly' | 'stage' | 'premium'; label: string; total: number; rows: Array<{ label: string; amount: number }>; include: boolean }>).filter(pkg => pkg.include);

        return (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-semibold text-emerald-950">Fee Package from CRM</h4>
                <p className="text-xs text-emerald-700 mt-0.5">
                  {feeData.serviceName} · {feeData.countryName}{feeData.branchName ? ` · ${feeData.branchName}` : ''}
                </p>
              </div>
              <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-medium">{cur}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {packages.map(pkg => {
                const isSelected = paymentType === pkg.key;
                return (
                  <button
                    key={pkg.key}
                    type="button"
                    onClick={() => {
                      setPaymentType(pkg.key);
                      setData({ ...data, estimatedValue: String(pkg.total) });
                    }}
                    className={`text-left rounded-lg border-2 p-3 transition-all ${
                      isSelected
                        ? 'border-emerald-500 bg-white shadow'
                        : 'border-gray-200 bg-white hover:border-emerald-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{pkg.label}</span>
                      {isSelected && <span className="text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded">Selected</span>}
                    </div>
                    <div className="space-y-1 mb-2">
                      {pkg.rows.map(r => (
                        <div key={r.label} className="flex justify-between text-xs text-gray-600">
                          <span>{r.label}</span>
                          <span>{cur} {fmt(r.amount)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-gray-200 pt-1.5 flex justify-between font-bold text-sm text-emerald-800">
                      <span>Total</span>
                      <span>{cur} {fmt(pkg.total)}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {packages.length === 0 && (
              <p className="text-sm text-emerald-700">No fee package found for this service and country.</p>
            )}
          </div>
        );
      })()}

      {!feeData && !feeLoading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="inline mr-2" size={16} />
          No fee package found in CRM for this service &amp; country. Enter the estimated value manually.
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center">
          <AlertCircle className="mr-2 text-blue-600" size={20} />
          <span className="text-sm text-blue-800">Lead Status must be set to "Hot" and Lead Priority to "Hot" before continuing to Quotation.</span>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 flex items-center font-medium"
        >
          <Save className="mr-2" size={20} />
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button
          onClick={handleContinueToQuotation}
          disabled={!data.opportunityName || !data.estimatedValue || !data.serviceRequired || leadDraft.status !== 'Hot' || !['Hot', 'P1'].includes(leadDraft.priority)}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center font-medium"
        >
          Continue to Quotation
          <ChevronRight className="ml-2" size={20} />
        </button>
      </div>
    </div>
  );
}
