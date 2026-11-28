'use client';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isBranchManagerOrCeo } from '@/lib/roleChecks';
import { BANK_PAYMENT_OPTIONS, CARD_PAYMENT_OPTIONS } from '@/lib/paymentOptions';
import { uploadFileToBlob } from '@/lib/uploadToBlob';
import { getLeadBranchDetails, getBranchReceiptConfig, printReceipt, getAdminFeeAmount, getAdminFeeVatRate } from '@/lib/receiptTemplate';
import InstallmentPlanEditor from '@/components/Payments/InstallmentPlanEditor';
import InstallmentSchedulePanel from '@/components/Payments/InstallmentSchedulePanel';
import { validatePlan, type AllocatedInstallment } from '@/lib/installments';
import { Download, Upload, CheckCircle, AlertCircle, FileText, DollarSign, ChevronRight, ChevronLeft, Save, Receipt, Lock, RefreshCw } from 'lucide-react';
import { PaymentData } from './types';

export default function PaymentStage({ lead, data, setData, quotationTotal, quotationTax, quotationDiscount, opportunityId, onEnsureOpportunity, discountPending, discountStatus, onRefreshDiscount, onNext, onPrevious }: any) {
  const { user, currencyCode } = useAuth();
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [checkingDiscount, setCheckingDiscount] = useState(false);
  const [savedPlan, setSavedPlan] = useState<AllocatedInstallment[] | null>(null);
  // Once a receipt has been generated, only Branch Manager/CEO may still
  // change the payment details — a counselor's view of that receipt becomes
  // read-only so they can't alter what's already been issued to the client.
  const canEditAfterReceipt = isBranchManagerOrCeo(user as any);
  const receiptLocked = Boolean(receipt) && !canEditAfterReceipt;

  const normalizeReceiptForUi = (payment: any) => ({
    ...payment,
    accountantStatus: payment.accountantStatus || (payment.status === 'verified' || payment.status === 'rejected' ? payment.status : 'pending'),
    receiptNumber: payment.receiptNumber || payment.paymentNumber,
    paidAmount: payment.paidAmount ?? payment.amount ?? 0,
    remainingBalance: payment.remainingBalance ?? payment.balanceAmount ?? 0,
  });

  const syncPaymentDataFromReceipt = (payment: any) => {
    setData((current: PaymentData) => {
      const totalAmount = Number(payment?.totalAmount || current.totalAmount || quotationTotal || payment?.amount || current.paidAmount || 0);
      const paidAmount = Number(payment?.paidAmount ?? payment?.amount ?? current.paidAmount ?? 0);
      const remainingBalance = Number(payment?.remainingBalance ?? payment?.balanceAmount ?? Math.max(totalAmount - paidAmount, 0));

      return {
        ...current,
        totalAmount,
        paidAmount,
        remainingBalance,
        paymentStructure: payment?.paymentStructure || current.paymentStructure,
        paymentMethod: payment?.paymentMethod || current.paymentMethod,
        transactionId: payment?.transactionId || current.transactionId,
        paymentDate: payment?.paymentDate ? new Date(payment.paymentDate).toISOString().slice(0, 10) : current.paymentDate,
      };
    });
  };

  useEffect(() => {
    // Once a receipt/payment has actually been recorded for this opportunity,
    // its stored totalAmount/paidAmount/remainingBalance are frozen, authoritative
    // history — what the client was actually charged, including whatever
    // discount was approved at that moment. A later live recalculation of
    // quotationTotal (e.g. the discount-approval refresh effect, or simply
    // re-deriving the quotation on remount) must never silently overwrite
    // that with today's numbers, or a fully-paid opportunity's balance can
    // flicker back to non-zero just from reopening it.
    if (receipt) return;
    const total = Number(quotationTotal);
    if (Number.isFinite(total) && total > 0 && data.totalAmount !== total) {
      const paidAmount = Math.min(Number(data.paidAmount || 0), total);
      setData({ ...data, totalAmount: total, paidAmount, remainingBalance: Math.max(total - paidAmount, 0) });
    }
  }, [quotationTotal, receipt]);

  // Re-hydrate the receipt banner when this stage remounts (e.g. navigating away
  // to Documents/Agreement and back, or reloading mid-flow). Without this, a
  // receipt that was already created on an earlier visit silently disappears
  // from view, and the user can be misled into clicking Save again - which
  // takes the "opportunity already exists" branch below and POSTs /api/receipts
  // unconditionally, creating a genuine duplicate payment/receipt.
  useEffect(() => {
    if (!opportunityId || receipt) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/opportunity-payments?opportunityId=${opportunityId}&_=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const payments = await res.json();
        const latestPayment = Array.isArray(payments) ? payments[0] : payments?.data?.[0];
        if (latestPayment && !cancelled) {
          const normalizedPayment = normalizeReceiptForUi(latestPayment);
          setReceipt(normalizedPayment);
          syncPaymentDataFromReceipt(normalizedPayment);
        }
      } catch (error) {
        console.error('Error re-hydrating receipt:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [opportunityId]);

  // The re-hydration effect above only runs once (it bails out once `receipt`
  // is set), so a receipt that gets verified by Accounts *after* it was
  // loaded here never updates on its own — the Download Receipt button stays
  // hidden even once approved. This lets the counselor pull the latest
  // accountantStatus/remarks on demand instead of reloading the whole page.
  const refreshVerificationStatus = async () => {
    if (!opportunityId) return;
    setCheckingStatus(true);
    try {
      const res = await fetch(`/api/opportunity-payments?opportunityId=${opportunityId}&_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to check verification status');
      const payments = await res.json();
      const list = Array.isArray(payments) ? payments : payments?.data || [];
      const latestPayment = receipt
        ? list.find((p: any) => p.id === receipt.id || p.paymentNumber === receipt.paymentNumber) || list[0]
        : list[0];
      if (latestPayment) {
        const normalizedPayment = normalizeReceiptForUi(latestPayment);
        setReceipt(normalizedPayment);
        syncPaymentDataFromReceipt(normalizedPayment);
      }
    } catch (error) {
      console.error('Error refreshing verification status:', error);
      window.toast.error('Failed to refresh verification status');
    } finally {
      setCheckingStatus(false);
    }
  };

  const hasProofOfPayment = data.proofOfPayment instanceof File || Boolean(data.proofOfPaymentUrl || receipt?.proofOfPaymentUrl);
  // Preview only — the amount actually recorded is always recomputed
  // server-side from the branch in /api/receipts, never trusted from here.
  const adminFeeBranchDetails = getLeadBranchDetails(lead as any);
  const adminFeeBaseAmount = getAdminFeeAmount(adminFeeBranchDetails.branchName, adminFeeBranchDetails.branchAddress, currencyCode);
  // The VAT checkbox only applies to branches that actually charge VAT/GST.
  const branchHasVat = getBranchReceiptConfig(
    adminFeeBranchDetails.branchName, currencyCode, adminFeeBranchDetails.branchAddress,
    null, null, adminFeeBranchDetails.vatGstPercent,
  ).hasVat;
  const adminFeeVatRate = data.includeVat === false ? 0 : getAdminFeeVatRate(adminFeeBranchDetails.branchName, adminFeeBranchDetails.branchAddress);
  const adminFeeVatPreviewAmount = adminFeeBaseAmount * (adminFeeVatRate / 100);
  const adminFeePreviewAmount = adminFeeBaseAmount + adminFeeVatPreviewAmount;

  const ensureProofOfPaymentUrl = async () => {
    if (data.proofOfPaymentUrl) return data.proofOfPaymentUrl;
    if (!(data.proofOfPayment instanceof File)) return '';

    const safeName = data.proofOfPayment.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = await uploadFileToBlob(
      data.proofOfPayment,
      `payment-proofs/lead-${lead.id}/${Date.now()}_${safeName}`
    );
    setData({ ...data, proofOfPaymentUrl: blob.url });
    return blob.url;
  };

  const handleSave = async () => {
    if (!lead?.id) { window.toast.error('Lead data not loaded.'); return; }
    if (!hasProofOfPayment) { window.toast.warning('Upload proof of payment before creating the receipt.'); return; }
    // Re-check discount approval against the database right before creating
    // the receipt, rather than trusting whatever was cached when this stage
    // first loaded - a discount approved (by BM/CEO, or the auto-approve
    // tier) after the page opened would otherwise still read as "not
    // approved" here even though Discount Management already shows it approved.
    if (Number(quotationDiscount) > 0 && discountStatus !== 'approved' && onRefreshDiscount) {
      const freshStatus = await onRefreshDiscount();
      if (freshStatus !== 'approved') {
        window.toast.error(
          freshStatus === 'pending'
            ? 'This discount is still pending approval in Discount Management. It must be approved before a receipt can be created.'
            : 'This discount is not approved in Discount Management yet. It must be approved before a receipt can be created.'
        );
        return;
      }
    }
    // A first-time plan is validated here; afterwards it is edited in its own panel.
    if (!opportunityId && data.paymentStructure === 'installment') {
      const balance = Math.max(Number(quotationTotal || data.totalAmount || 0) - Number(data.paidAmount || 0), 0);
      const planError = balance > 0 ? validatePlan(data.installments, balance) : null;
      if (planError) { window.toast.error(planError); return; }
    }
    setSaving(true);
    try {
      const proofOfPaymentUrl = await ensureProofOfPaymentUrl();
      if (!proofOfPaymentUrl) throw new Error('Proof of payment upload failed');
      const totalAmount = Number(quotationTotal || data.totalAmount || 0);
      const paidAmount = Math.min(Math.max(0, Number(data.paidAmount || 0)), totalAmount);
      const remainingBalance = Math.max(totalAmount - paidAmount, 0);
      // The opportunity may not exist yet at this stage (Payment comes before
      // Documents/Agreement in the flow). Ensuring it here — rather than
      // leaving opportunityId hardcoded to null — is what lets this payment
      // actually count toward the opportunity: Accounts verification, the
      // Invoices & Payments receipt, and the agreement-number lookup all key
      // off crm_opportunity_payments.opportunityId, so a null value made this
      // payment invisible everywhere except this wizard's own local state.
      const hadOpportunityAlready = Boolean(opportunityId);
      const ensuredOpportunityId = await onEnsureOpportunity({ proofOfPaymentUrl, totalAmount, paidAmount, remainingBalance });

      if (!hadOpportunityAlready) {
        // ensureOpportunityForClient() just created the opportunity via
        // /api/lead-to-opportunity, which already recorded this exact payment
        // (it reads the same paymentData this stage holds) — fetch that
        // record back instead of submitting a second, duplicate payment.
        const payRes = await fetch(`/api/opportunity-payments?opportunityId=${ensuredOpportunityId}`);
        const payments = await payRes.json();
        const latestPayment = Array.isArray(payments) ? payments[0] : null;
        const normalizedPayment = latestPayment ? normalizeReceiptForUi(latestPayment) : null;
        setReceipt(normalizedPayment);
        if (normalizedPayment) syncPaymentDataFromReceipt(normalizedPayment);
        window.toast.success(`Receipt ${normalizedPayment?.paymentNumber || ''} created successfully!`);
      } else {
        const res = await fetch('/api/receipts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: lead.id,
            opportunityId: ensuredOpportunityId,
            paymentData: {
              paymentStructure: data.paymentStructure,
              paymentMethod: data.paymentMethod,
              transactionId: data.transactionId,
              paymentDate: data.paymentDate,
              paidAmount,
              totalAmount,
              amount: paidAmount,
              proofOfPaymentUrl,
              dueDate: data.dueDate || undefined,
              remark: data.remark || undefined,
              adminFeeIncluded: data.adminFeeIncluded || false,
              includeVat: data.includeVat !== false,
            },
            receiptData: {
              description: `Payment receipt for ${lead.fname} ${lead.lname}`,
              receiptType: 'payment',
              taxAmount: Number(quotationTax) || 0,
              discountAmount: Number(quotationDiscount) || 0,
              notes: '',
            },
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to create receipt');
        const normalizedPayment = normalizeReceiptForUi(json.data?.receipt || json.data || json);
        setReceipt(normalizedPayment);
        syncPaymentDataFromReceipt(normalizedPayment);
        window.toast.success(`Receipt ${json.data?.receipt?.receiptNumber || ''} created successfully!`);
      }
    } catch (error: any) {
      console.error('Error saving payment:', error);
      window.toast.error(error.message || 'Failed to save payment');
    } finally {
      setSaving(false);
    }
  };

  const downloadReceiptPDF = async () => {
    if (!receipt && !data.paidAmount) { window.toast.warning('Save the payment first to generate a receipt.'); return; }
    setPrintingReceipt(true);
    const r = receipt || {};
    const branchDetails = getLeadBranchDetails(lead as any);
    printReceipt({
      receiptNumber: r.receiptNumber,
      paymentNumber: r.paymentNumber,
      paymentDate: r.paymentDate,
      clientName: r.clientName || (lead as any)?.client_actual_name || `${lead?.fname || ''} ${lead?.lname || ''}`.trim() || 'Client',
      email: lead?.email,
      phone: lead?.mobile || lead?.phone,
      passportNumber: (lead as any)?.id_number || '',
      agreementNumber: r.agreementNumber,
      opportunityId,
      serviceName: r.serviceName || (lead as any)?.service_interest_label || lead?.service_interest,
      consultantName: r.consultantName,
      companyName: r.companyName || branchDetails.companyName,
      branchName: r.branchName || branchDetails.branchName,
      branchAddress: r.branchAddress || branchDetails.branchAddress,
      branchEmail: r.branchEmail || branchDetails.branchEmail,
      branchPhone: r.branchPhone || branchDetails.branchPhone,
      branchAbbrv: branchDetails.branchAbbrv,
      licenseNumber: branchDetails.licenseNumber,
      vatGstPercent: branchDetails.vatGstPercent,
      paymentMethod: data.paymentMethod,
      transactionId: data.transactionId,
      currency: r.currency || currencyCode,
      totalAmount: data.totalAmount || r.totalAmount,
      paidAmount: data.paidAmount || r.paidAmount || r.amount,
      remainingBalance: data.remainingBalance,
      remark: r.remark || data.remark,
      adminFeeIncluded: r.adminFeeIncluded ?? data.adminFeeIncluded,
      adminFeeAmount: r.adminFeeAmount ?? (data.adminFeeIncluded ? getAdminFeeAmount(branchDetails.branchName, branchDetails.branchAddress, r.currency || currencyCode) : 0),
      includeVat: r.includeVat ?? data.includeVat,
      installments: savedPlan ?? r.installmentPlan,
    });
    setPrintingReceipt(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <DollarSign className="mr-3 text-blue-600" size={28} />
        <div>
          <h3 className="text-2xl font-bold text-gray-900">Payment Stage</h3>
          <p className="text-gray-600 text-sm">Process payment and configure payment structure</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h4 className="font-semibold text-lg mb-4 text-gray-900">Payment Structure</h4>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Payment Type</label>
              <SearchableSelect
                value={data.paymentStructure}
                onChange={(e) => setData({ ...data, paymentStructure: e.target.value })}
                disabled={receiptLocked}
                className="w-full p-3 border rounded-lg disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="full">Full Payment</option>
                <option value="installment">Installment</option>
                <option value="milestone">Milestone Based</option>
              </SearchableSelect>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Total Amount</label>
              <input
                type="number"
                value={quotationTotal}
                readOnly
                className="w-full p-3 border rounded-lg bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Amount Paid</label>
              <input
                type="number"
                value={data.paidAmount || ''}
                onChange={(e) => {
                  const paid = parseFloat(e.target.value) || 0;
                  setData({ ...data, paidAmount: paid, remainingBalance: quotationTotal - paid });
                }}
                disabled={receiptLocked}
                placeholder="0"
                className="w-full p-3 border rounded-lg disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Remaining Balance</label>
              <input
                type="number"
                value={data.remainingBalance}
                readOnly
                className="w-full p-3 border rounded-lg bg-gray-50"
              />
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h4 className="font-semibold text-lg mb-4 text-gray-900">Payment Details</h4>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
              <SearchableSelect
                value={data.paymentMethod}
                onChange={(e) => setData({ ...data, paymentMethod: e.target.value })}
                disabled={receiptLocked}
                className="w-full p-3 border rounded-lg disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="cash">Cash</option>
                <option value="credit_card">Credit Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <optgroup label="Bank">
                  {BANK_PAYMENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Card / POS">
                  {CARD_PAYMENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </optgroup>
              </SearchableSelect>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Transaction ID</label>
              <input
                type="text"
                value={data.transactionId}
                onChange={(e) => setData({ ...data, transactionId: e.target.value })}
                disabled={receiptLocked}
                className="w-full p-3 border rounded-lg disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="Enter transaction reference"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Payment Date</label>
              <input
                type="date"
                value={data.paymentDate}
                onChange={(e) => setData({ ...data, paymentDate: e.target.value })}
                disabled={receiptLocked}
                className="w-full p-3 border rounded-lg disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div className={data.paymentStructure === 'installment' ? 'hidden' : undefined}>
              <label className="block text-sm font-medium text-gray-700 mb-2">Balance Due Date</label>
              <input
                type="date"
                value={data.dueDate}
                onChange={(e) => setData({ ...data, dueDate: e.target.value })}
                disabled={receiptLocked}
                className="w-full p-3 border rounded-lg disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="When the remaining balance is due"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Proof of Payment <span className="text-red-500">*</span></label>
              {data.proofOfPayment instanceof File ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="text-sm text-green-800 truncate flex-1">{data.proofOfPayment.name}</span>
                  {!receiptLocked && (
                    <button
                      type="button"
                      onClick={() => setData({ ...data, proofOfPayment: null, proofOfPaymentUrl: null })}
                      className="text-red-500 hover:text-red-700 text-xs shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ) : (
                <label className={`flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg transition-colors ${receiptLocked ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : 'border-gray-300 cursor-pointer hover:border-blue-400 hover:bg-blue-50'}`}>
                  <Upload className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-600">Choose file</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    className="hidden"
                    disabled={receiptLocked}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setData({ ...data, proofOfPayment: file, proofOfPaymentUrl: null });
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        </div>
      </div>

      {(opportunityId || data.paymentStructure === 'installment') && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h4 className="font-semibold text-lg mb-1 text-gray-900">Instalment Plan</h4>
          <p className="text-xs text-gray-500 mb-4">Splits the remaining balance. Dates and amounts appear on the receipt, agreement, Balance Payments and dashboard.</p>
          {opportunityId ? (
            <InstallmentSchedulePanel opportunityId={Number(opportunityId)} refreshKey={receipt?.id} onLoaded={setSavedPlan} />
          ) : (
            <InstallmentPlanEditor
              total={Math.max(Number(quotationTotal || 0) - Number(data.paidAmount || 0), 0)}
              currency={currencyCode}
              rows={data.installments}
              onChange={(installments) => setData((current: PaymentData) => ({ ...current, installments }))}
            />
          )}
        </div>
      )}

      {branchHasVat && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={data.includeVat !== false}
              onChange={(e) => setData({ ...data, includeVat: e.target.checked })}
              disabled={receiptLocked}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium text-gray-700">Include VAT on receipt</span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-7">
            Unchecked prints a plain Payment Receipt with no VAT/GST wording (also removes VAT from the admin fee).
          </p>
        </div>
      )}

      {adminFeePreviewAmount > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={data.adminFeeIncluded}
              onChange={(e) => setData({ ...data, adminFeeIncluded: e.target.checked })}
              disabled={receiptLocked}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium text-gray-700">
              Include Admin Fee (+{currencyCode} {adminFeeBaseAmount}{adminFeeVatRate > 0 ? ` + ${currencyCode} ${adminFeeVatPreviewAmount.toFixed(0)} VAT (${adminFeeVatRate}%)` : ''} = {currencyCode} {adminFeePreviewAmount.toFixed(0)} on the printed receipt)
            </span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-7">
            Added as a separate line on the receipt — does not change the client's package balance.
          </p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Remark</label>
        <textarea
          value={data.remark}
          onChange={(e) => setData({ ...data, remark: e.target.value })}
          rows={3}
          disabled={receiptLocked}
          className="w-full p-3 border rounded-lg disabled:bg-gray-50 disabled:text-gray-500"
          placeholder="Notes about this payment or the remaining balance..."
        />
      </div>

      {receipt && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="font-semibold text-green-800">Receipt Created: {receipt.receiptNumber || receipt.paymentNumber}</div>
            <div className="text-sm text-green-700">Amount: {receipt.currency || currencyCode} {Number(receipt.paidAmount || receipt.amount || 0).toLocaleString()}</div>
            {receipt.agreementNumber && (
              <div className="text-sm text-green-700">Agreement Number: <span className="font-medium">{receipt.agreementNumber}</span></div>
            )}
            {receiptLocked && (
              <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                <Lock size={12} /> Locked — only Branch Manager or CEO can edit a receipt after it's generated.
              </div>
            )}
          </div>
          {receipt.accountantStatus === 'verified' ? (
            <div className="flex items-center gap-2">
              <button onClick={downloadReceiptPDF} disabled={printingReceipt}
                className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm hover:bg-green-800 flex items-center gap-2 disabled:opacity-60">
                <Download size={16}/> {printingReceipt ? 'Opening…' : 'Download Receipt PDF'}
              </button>
              {opportunityId && (
                <button onClick={() => window.open(`/admin/leads/receipt/${opportunityId}`, '_blank')}
                  className="px-4 py-2 border border-green-700 text-green-700 rounded-lg text-sm hover:bg-green-50 flex items-center gap-2">
                  <FileText size={16}/> Open Receipt Page
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-3 py-1.5">
                Awaiting accounts verification
              </span>
              <button onClick={refreshVerificationStatus} disabled={checkingStatus}
                className="px-3 py-1.5 border border-amber-300 text-amber-800 rounded-lg text-xs hover:bg-amber-100 flex items-center gap-1.5 disabled:opacity-60">
                <RefreshCw size={13} className={checkingStatus ? 'animate-spin' : ''}/> {checkingStatus ? 'Checking…' : 'Check Status'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onPrevious}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 flex items-center font-medium"
        >
          <ChevronLeft className="mr-2" size={20} />
          Back to Quotation
        </button>
        <div className="flex gap-3">
          {receipt?.accountantStatus === 'verified' && (
            <button
              onClick={downloadReceiptPDF}
              disabled={printingReceipt}
              className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 flex items-center font-medium"
            >
              <Receipt className="mr-2" size={20} />
              {printingReceipt ? 'Opening…' : 'Print Receipt'}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || receiptLocked || !hasProofOfPayment}
            title={receiptLocked ? 'Only Branch Manager or CEO can edit a receipt after it\'s generated.' : !hasProofOfPayment ? 'Upload proof of payment before creating the receipt.' : undefined}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center font-medium"
          >
            {receiptLocked ? <Lock className="mr-2" size={20} /> : <Save className="mr-2" size={20} />}
            {saving ? 'Saving…' : receiptLocked ? 'Receipt Locked' : 'Save & Create Receipt'}
          </button>
          <button
            onClick={() => {
              if (receipt) syncPaymentDataFromReceipt(receipt);
              onNext();
            }}
            disabled={discountPending || !receipt}
            title={discountPending ? 'Waiting on discount approval in Discount Management' : !receipt ? 'Save & Create Receipt before continuing' : undefined}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center font-medium"
          >
            Move to Accounts
            <ChevronRight className="ml-2" size={20} />
          </button>
        </div>
        {discountPending && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="flex items-center gap-2">
              <AlertCircle size={18} />
              <span>
                A discount was applied to this opportunity and is {discountStatus === 'pending' ? 'still pending' : 'not yet'} approved in Discount Management by a Branch Manager or CEO. This flow can't continue until it's approved.
                {' '}Already approved it? The status here may just be out of date — use Re-check.
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!onRefreshDiscount || checkingDiscount) return;
                setCheckingDiscount(true);
                try {
                  const status = await onRefreshDiscount();
                  if (status === 'approved') window.toast.success('Discount is approved — you can continue.');
                  else window.toast.info('Still not approved in Discount Management.');
                } finally {
                  setCheckingDiscount(false);
                }
              }}
              disabled={checkingDiscount}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              <RefreshCw size={14} className={checkingDiscount ? 'animate-spin' : ''} />
              {checkingDiscount ? 'Checking…' : 'Re-check'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
