'use client';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isCeo } from '@/lib/roleChecks';
import { renderAgreementForBranch } from '@/lib/renderAgreementForBranch';
import { getLeadBranchDetails } from '@/lib/receiptTemplate';
import { Trash2, Download, FileText, FileSignature, ChevronRight, ChevronLeft, PenTool, Sparkles, Loader2 } from 'lucide-react';
import { AgreementData, COUNSELOR_SUMMARY_MIN_CHARS } from './types';

export default function AgreementStage({ lead, data, setData, quotationData, paidAmount, programValidity, opportunityId, onSaveAgreement, onDeleteAgreement, onNext, onPrevious }: any) {
  const { user } = useAuth();
  const canDelete = isCeo(user as any);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const counselorSummaryLength = data.counselorConversationSummary.trim().length;

  const handleSummarizeCase = async () => {
    if (!lead?.id) return;
    setSummarizing(true);
    try {
      const response = await fetch(`/api/leads/${lead.id}/summarize-case`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.summary) {
        setData({ ...data, counselorConversationSummary: result.summary });
      } else {
        window.toast.error(result.error || 'Failed to generate a summary.');
      }
    } catch (error) {
      console.error('Error summarizing case:', error);
      window.toast.error('Failed to generate a summary.');
    } finally {
      setSummarizing(false);
    }
  };

  // Continue used to call onNext directly, so a counselor could click
  // straight through to Signed Agreement without the separate (optional)
  // "Save Draft" button ever being clicked - leaving no row in
  // crm_opportunity_agreements at all. Continue now always saves the
  // agreement first and only advances on success, which makes a standalone
  // Save Draft button redundant (removed below).
  const handleContinue = async () => {
    setSaving(true);
    try {
      await onSaveAgreement();
      onNext();
    } catch (error) {
      console.error('Error saving agreement:', error);
      window.toast.error('Failed to save the agreement. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const downloadAgreementPdf = async () => {
    setGeneratingPdf(true);
    try {
      const clientName = (lead as any)?.client_actual_name || [lead?.fname, lead?.lname].filter(Boolean).join(' ') || lead?.name || 'Client';
      const destinationCountry = (lead as any)?.country_interest_label || (lead as any)?.country_interest || 'Not specified';
      const serviceProgram   = (lead as any)?.service_interest_label  || (lead as any)?.service_interest  || data.agreementType || 'Consulting Service';
      const branchDetails = getLeadBranchDetails(lead as any);

      // Pull payment amounts from quotation if available. Initial Payment is
      // the amount actually paid at receipt generation (Payment stage), not
      // the pre-discount quotation subtotal.
      const totalAmount    = quotationData?.total    || data.amount || (lead as any)?.payTotal || (lead as any)?.demandAmt || '0';
      const initialPayment = String(Math.min(Math.max(0, Number(paidAmount || 0)), Number(totalAmount) || 0));
      const secondPayment  = String(Math.max(0, Number(totalAmount) - Number(initialPayment)));

      const savedAgreementId = await onSaveAgreement();

      // Looked up by agreement so it works even when the opportunity was created a moment ago.
      const agreementKey = data.agreementNumber || savedAgreementId;
      const lookup = agreementKey ? await fetch(`/api/admin/agreements/lookup?agreementNumber=${encodeURIComponent(String(agreementKey))}`, { cache: 'no-store' }) : null;
      const installments = lookup?.ok ? (await lookup.json()).data?.installments : undefined;

      const html = renderAgreementForBranch(branchDetails.branchAbbrv, {
        installments,
        // Use the number that was just saved to (or already existed in) the
        // database rather than minting a new one — otherwise the downloaded
        // PDF shows a different agreement number than the saved record.
        agreementNumber : data.agreementNumber || `AGR-${savedAgreementId || Date.now()}`,
        agreementDate   : new Date().toLocaleDateString('en-GB'),
        agreementExpiry : data.endDate ? new Date(data.endDate).toLocaleDateString('en-GB') : '',
        clientName,
        clientEmail   : (lead as any)?.email      || '',
        clientPhone   : (lead as any)?.phone      || (lead as any)?.mobile || '',
        clientAddress : (lead as any)?.address    || '',
        nationality   : (lead as any)?.nationality || '',
        passportNumber: (lead as any)?.id_number || '',
        idNumber      : (lead as any)?.emirates_id || (lead as any)?.id_number  || '',
        serviceProgram,
        programCode   : data.agreementType || '',
        programTermSchedule: programValidity || (data.startDate && data.endDate ? `${data.startDate} to ${data.endDate}` : ''),
        destinationCountry,
        totalAmount   : String(totalAmount),
        initialPayment,
        secondPayment,
        clientId      : String((lead as any)?.id || ''),
        includedDeliverables: data.agreementTitle || '',
        expressExclusions: '',
        specialTerms: data.terms || '',
      });

      // Open in a new tab — browser renders Arabic natively, user saves as PDF via Ctrl+P / Print dialog
      const win = window.open('', '_blank', 'width=900,height=700');
      if (!win) { window.toast.warning('Please allow pop-ups to open the agreement.'); return; }
      win.document.write(html);
      win.document.close();
      // Trigger print after fonts have loaded
      win.addEventListener('load', () => {
        setTimeout(() => win.print(), 400);
      });
      // Fallback if load already fired
      if (win.document.readyState === 'complete') {
        setTimeout(() => win.print(), 600);
      }

      setData((current: AgreementData) => ({ ...current, status: 'generated' }));
    } catch (error) {
      console.error('Error generating agreement PDF:', error);
      window.toast.error('Failed to generate agreement PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDelete = async () => {
    if (!data.agreementId) return;
    if (!window.confirm('Delete this agreement? This cannot be undone.')) return;

    setSaving(true);
    try {
      await onDeleteAgreement();
      window.toast.success('Agreement deleted.');
    } catch (error) {
      console.error('Error deleting agreement:', error);
      window.toast.error(error instanceof Error ? error.message : 'Failed to delete agreement');
    } finally {
      setSaving(false);
    }
  };

  const [lookupNumber, setLookupNumber] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);

  // An agreement number is often already generated for this opportunity (the
  // Payment stage's first save auto-creates one) before the counselor ever
  // reaches this stage — pre-fill the lookup box with it instead of leaving
  // it blank, so fetching/downloading is a single click, not manual entry.
  useEffect(() => {
    if (data.agreementNumber && !lookupNumber) {
      setLookupNumber(data.agreementNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.agreementNumber]);

  const handleAgreementLookup = async () => {
    const num = lookupNumber.trim();
    if (!num) return;
    setLookupLoading(true);
    try {
      const res = await fetch(`/api/opportunity-agreements?agreementNumber=${encodeURIComponent(num)}`);
      if (!res.ok) throw new Error('Not found');
      const json = await res.json();
      const agr = Array.isArray(json.data) ? json.data[0] : json.data ?? json;
      if (!agr) { window.toast.warning(`No agreement found with number: ${num}`); return; }
      setData((prev: AgreementData) => ({
        ...prev,
        agreementId: agr.id ?? prev.agreementId,
        agreementNumber: agr.agreementNumber ?? prev.agreementNumber,
        agreementType: agr.agreementType ?? agr.type ?? prev.agreementType,
        agreementTitle: agr.title ?? agr.agreementTitle ?? prev.agreementTitle,
        terms: agr.termsAndConditions ?? agr.terms ?? prev.terms,
        startDate: agr.startDate ? String(agr.startDate).split('T')[0] : prev.startDate,
        endDate: agr.endDate ? String(agr.endDate).split('T')[0] : prev.endDate,
        amount: agr.totalAmount ? String(agr.totalAmount) : prev.amount,
        companyName: agr.companyName ?? prev.companyName,
        companyAddress: agr.companyAddress ?? prev.companyAddress,
        status: agr.status ?? prev.status,
      }));
      window.toast.success(`Agreement ${num} loaded successfully.`);
    } catch {
      window.toast.warning(`No agreement found with number: ${num}`);
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <PenTool className="mr-3 text-blue-600" size={28} />
        <div>
          <h3 className="text-2xl font-bold text-gray-900">Agreement Generation</h3>
          <p className="text-gray-600 text-sm">Generate service agreement document</p>
        </div>
      </div>

      {data.agreementNumber && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-green-700 uppercase">Agreement Number</span>
            <p className="text-lg font-bold text-green-900">{data.agreementNumber}</p>
          </div>
          <FileSignature className="text-green-600" size={24} />
        </div>
      )}

      {/* Agreement number lookup */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-blue-900 mb-2">Lookup Existing Agreement</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={lookupNumber}
            onChange={(e) => setLookupNumber(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAgreementLookup()}
            placeholder="Enter Agreement Number (e.g. AGR-001)"
            className="flex-1 p-2.5 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAgreementLookup}
            disabled={lookupLoading || !lookupNumber.trim()}
            className="px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium"
          >
            {lookupLoading ? 'Loading...' : 'Fetch & Fill'}
          </button>
        </div>
        <p className="text-xs text-blue-600 mt-1">
          {data.agreementNumber
            ? 'This opportunity\'s agreement number is filled in — click Fetch & Fill to reload its details, or scroll down to download.'
            : 'Enter an agreement number and click Fetch to auto-fill all fields below.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Agreement Type</label>
          <SearchableSelect
            value={data.agreementType}
            onChange={(e) => setData({ ...data, agreementType: e.target.value })}
            className="w-full p-3 border rounded-lg"
          >
            <option value="service_agreement">Auto by Product</option>
            <option value="canada-single">Canada Single</option>
            <option value="europe-work-permit">Europe Work Permit</option>
            <option value="job-search">Job Search</option>
            <option value="visit-visa">Visit Visa</option>
            <option value="australia-single">Australia Single</option>
            <option value="student-visa">Student Visa</option>
            <option value="goc">Germany Opportunity Card</option>
            <option value="eip">Economic Immigration Program</option>
            <option value="work-permit-visa-application">Work Permit Visa Application</option>
            <option value="yukon-gcc">Yukon GCC</option>
          </SearchableSelect>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Agreement Title</label>
          <input
            type="text"
            value={data.agreementTitle}
            onChange={(e) => setData({ ...data, agreementTitle: e.target.value })}
            className="w-full p-3 border rounded-lg"
            placeholder="Enter agreement title"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Terms and Conditions</label>
        <textarea
          value={data.terms}
          onChange={(e) => setData({ ...data, terms: e.target.value })}
          rows={6}
          className="w-full p-3 border rounded-lg"
          placeholder="Enter terms and conditions..."
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">
            Counselor Conversation Summary <span className="text-red-500">*</span>
          </label>
          <button
            type="button"
            onClick={handleSummarizeCase}
            disabled={summarizing}
            className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
            title="Draft this summary from the lead's full activity history (Claude)"
          >
            {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {summarizing ? 'Summarizing...' : 'Summarize with AI'}
          </button>
        </div>
        <textarea
          value={data.counselorConversationSummary}
          onChange={(e) => setData({ ...data, counselorConversationSummary: e.target.value })}
          rows={4}
          className={`w-full p-3 border rounded-lg ${counselorSummaryLength > 0 && counselorSummaryLength < COUNSELOR_SUMMARY_MIN_CHARS ? 'border-red-300 focus:border-red-500' : ''}`}
          placeholder="Summarize the conversation with the client regarding their service requirements, expectations, and any commitments made..."
        />
        <div className="mt-1 flex items-center justify-between gap-3 text-xs">
          <span className={counselorSummaryLength < COUNSELOR_SUMMARY_MIN_CHARS ? 'text-red-600' : 'text-green-700'}>
            Minimum {COUNSELOR_SUMMARY_MIN_CHARS} characters required
          </span>
          <span className="text-gray-500">{counselorSummaryLength}/{COUNSELOR_SUMMARY_MIN_CHARS}</span>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={downloadAgreementPdf}
          disabled={generatingPdf}
          className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center justify-center font-medium"
        >
          <Download className="mr-2" size={20} />
          {generatingPdf ? 'Opening Agreement...' : 'Generate & Print Agreement (PDF)'}
        </button>
        {opportunityId && (
          <button
            onClick={() => window.open(`/admin/leads/agreement/${opportunityId}`, '_blank')}
            className="px-6 py-3 border border-green-600 text-green-700 rounded-lg hover:bg-green-50 flex items-center justify-center font-medium"
          >
            <FileText className="mr-2" size={20} />
            Open Agreement Page
          </button>
        )}
      </div>

      <div className="flex justify-between">
        <button
          onClick={onPrevious}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 flex items-center font-medium"
        >
          <ChevronLeft className="mr-2" size={20} />
          Back to Documents
        </button>
        <div className="flex gap-3">
          {data.agreementId && canDelete && (
            <button
              onClick={handleDelete}
              disabled={saving || generatingPdf}
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 flex items-center font-medium"
            >
              <Trash2 className="mr-2" size={20} />
              Delete Agreement
            </button>
          )}
          <button
            onClick={handleContinue}
            disabled={saving}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center font-medium"
          >
            {saving ? 'Saving...' : 'Continue to Signed Agreement'}
            <ChevronRight className="ml-2" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
