'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isBranchManagerOrCeo } from '@/lib/roleChecks';
import { getBranchTaxInfo } from '@/lib/branchTax';
import { getLeadBranchDetails } from '@/lib/receiptTemplate';
import { getDiscountTier, getDiscountPercentage, DEFAULT_DISCOUNT_TIER_THRESHOLDS, type DiscountTierThresholds } from '@/lib/discountApproval';
import { FileText, Send, ChevronRight, ChevronLeft, RefreshCw } from 'lucide-react';

export default function QuotationStage({ lead, data, setData, feeData, feeLoading, retentionData, requestingDiscount, onRequestDiscount, onRefreshDiscount, onDiscountChanged, onNext, onPrevious, paymentType, setPaymentType }: any) {
  const { user } = useAuth();
  const [appliedFeeKey, setAppliedFeeKey] = useState<string | null>(null);
  // Correcting a wrong amount / wrongly-approved-or-rejected discount -
  // temporarily unlocks the amount field even though a request already
  // exists, so a counselor can fix a mistake without needing Branch
  // Manager/CEO to do it for them.
  const [isReapplying, setIsReapplying] = useState(false);
  const currencyCode = feeData?.currencyCode || 'AED';
  // Live discount-approval tier thresholds (staff-editable in Discount
  // Management) - fetched so the counselor sees the real, current tier
  // instead of an assumed 20/30 split baked into the UI.
  const [tierThresholds, setTierThresholds] = useState<DiscountTierThresholds>(DEFAULT_DISCOUNT_TIER_THRESHOLDS);
  useEffect(() => {
    fetch('/api/discount-approvals/tier-config')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (json?.data) setTierThresholds(json.data); })
      .catch(() => {});
  }, []);
  // Tax treatment depends on the lead's own branch, not the fee's billing
  // currency: Dubai/Abu Dhabi charge 5% VAT, India charges 18% GST, Qatar and
  // Kuwait charge nothing.
  const branchDetails = getLeadBranchDetails(lead);
  const nameBasedVatInfo = getBranchTaxInfo(`${branchDetails.branchName} ${branchDetails.branchAddress}`);
  // Prefer the branch's own configured VAT/GST % (set in Admin > Branches) once
  // it's been entered; fall back to the name-based guess for branches nobody
  // has configured yet so tax doesn't just go to 0/undefined for them.
  const vatInfo = branchDetails.vatGstPercent !== null
    ? { rate: branchDetails.vatGstPercent / 100, label: nameBasedVatInfo.label }
    : nameBasedVatInfo;
  const vatRate = vatInfo.rate;
  const calculateQuotationTotals = (subtotal: number, discount: number) => {
    const safeSubtotal = Math.max(0, subtotal);
    const safeDiscount = Math.min(Math.max(0, discount || 0), safeSubtotal);
    const taxableAmount = Math.max(0, safeSubtotal - safeDiscount);
    const tax = taxableAmount * vatRate;
    return {
      subtotal: safeSubtotal,
      discount: safeDiscount,
      tax,
      total: taxableAmount + tax,
    };
  };
  // Manual line items are disabled for now — see the button below.
  const SHOW_ADD_ITEM_BUTTON = false;

  // ── Build fee items for the selected payment type ──
  // A quotation line item is the program the client is buying, not our
  // internal fee-tier breakdown — so this collapses upfront/prof/monthly or
  // stage amounts into a single item described by the selected program
  // (crm_service.name, via feeData.serviceName), priced at the full package total.
  const buildFeeItems = (fee: any, type: 'upfront' | 'monthly' | 'stage' | 'premium') => {
    const upfrontBase = Number(fee.upfront);
    const monthlyExtra = Number(fee.firstMonth) + Number(fee.secondMonth) + Number(fee.thirdMonth);
    const stageExtra = Number(fee.firstStage) + Number(fee.secondStage) + Number(fee.thirdStage) + Number(fee.forthStage) + Number(fee.fifthStage);
    const premiumTotal = Number(fee.premium_fee_1 || 0) + Number(fee.premium_fee_2 || 0);
    const total = type === 'upfront' ? upfrontBase : type === 'monthly' ? monthlyExtra : type === 'premium' ? premiumTotal : stageExtra;
    if (total <= 0) return [];
    return [{ description: fee.serviceName || 'Program Fee', quantity: 1, unitPrice: String(total), total: String(total) }];
  };

  // ── Auto-populate line items when fee data or payment type changes ──
  useEffect(() => {
    if (!feeData) return;
    const key = `${feeData.id}-${paymentType}`;
    if (appliedFeeKey === key) return;

    const items = buildFeeItems(feeData, paymentType);
    if (items.length === 0) return;

    const totals = calculateQuotationTotals(
      items.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0),
      data.discount || 0
    );

    setData({ ...data, items, ...totals });
    setAppliedFeeKey(key);
  }, [feeData, paymentType]);

  const addItem = () => {
    setData({
      ...data,
      items: [...data.items, { description: '', quantity: 1, unitPrice: '', total: '' }]
    });
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...data.items];
    newItems[index] = { ...newItems[index], [field]: value };

    if (field === 'quantity' || field === 'unitPrice') {
      const quantity = parseFloat(newItems[index].quantity) || 0;
      const unitPrice = parseFloat(newItems[index].unitPrice) || 0;
      newItems[index].total = (quantity * unitPrice).toFixed(2);
    }

    // Calculate totals
    const totals = calculateQuotationTotals(
      newItems.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0),
      data.discount
    );

    setData({ ...data, items: newItems, ...totals });
  };

  const updateDiscount = (value: string) => {
    const requested = Math.max(0, parseFloat(value) || 0);
    // A discount can never exceed the package's own amount — matches the
    // validateStage check that already blocks "Continue" for this same
    // reason, but catches it immediately as it's typed instead of only when
    // advancing to the next stage.
    const totals = calculateQuotationTotals(data.subtotal, requested);
    setData({ ...data, ...totals });
    onDiscountChanged?.(totals.discount);
  };

  const requiresDiscountApproval = data.discount > 0;
  const discountApproved = !requiresDiscountApproval || retentionData.discountStatus === 'approved';
  const discountStatusLabel = requiresDiscountApproval
    ? retentionData.discountStatus.replace('_', ' ')
    : 'not required';
  // Once a discount is approved (or a request is in flight), lock the amount so
  // it can't be silently changed - the approval was granted for a specific
  // figure, and discountApproved above only checks status, not the amount.
  // Branch Manager/CEO are exempt from this lock: they're the approvers
  // themselves, so they retain the ability to adjust the figure even after a
  // request is pending or already approved.
  const canEditLockedDiscount = isBranchManagerOrCeo(user as any);
  const discountLocked = (retentionData.discountStatus === 'pending' || retentionData.discountStatus === 'approved') && !canEditLockedDiscount && !isReapplying;
  // Only a genuinely existing request (pending/approved/rejected) can be
  // corrected - nothing to replace before the first request is ever made.
  const canReapplyDiscount = ['pending', 'approved', 'rejected'].includes(retentionData.discountStatus) && Boolean(retentionData.discountApprovalId);

  // Display-only: which tier the current amount falls into, purely to decide
  // what the counselor sees (auto-tier shows "Apply Discount" instead of
  // "Request Approval" — same explicit click either way, nothing is ever
  // submitted without the counselor pressing a button). The actual gate that
  // lets them proceed (discountApproved above) is untouched — it still
  // requires the real crm_discount_approvals row to come back 'approved',
  // auto-tier or not, since src/app/api/lead-to-opportunity/route.ts checks
  // for that row regardless of tier.
  const discountPercent = getDiscountPercentage(data.discount, data.subtotal);
  const discountTier = getDiscountTier(data.discount, data.subtotal, tierThresholds);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <FileText className="mr-3 text-blue-600" size={28} />
          <div>
            <h3 className="text-2xl font-bold text-gray-900">Quotation Stage</h3>
            <p className="text-gray-600 text-sm">Generate quotation for the opportunity</p>
          </div>
        </div>
        {feeLoading && (
          <span className="text-sm text-blue-600 animate-pulse">Loading fee package...</span>
        )}
      </div>

      {/* ── Payment Package (read-only here — chosen on the Prospect stage) ── */}
      {feeData && (() => {
        const packageLabel = paymentType === 'stage' ? 'Stage-wise' : paymentType === 'monthly' ? 'Monthly' : paymentType === 'premium' ? 'Premium (50/50)' : 'Upfront Only';
        const packageTotal = paymentType === 'stage'
          ? Number(feeData.firstStage) + Number(feeData.secondStage) + Number(feeData.thirdStage) + Number(feeData.forthStage) + Number(feeData.fifthStage)
          : paymentType === 'monthly'
            ? Number(feeData.firstMonth) + Number(feeData.secondMonth) + Number(feeData.thirdMonth)
            : paymentType === 'premium'
              ? Number(feeData.premium_fee_1 || 0) + Number(feeData.premium_fee_2 || 0)
              : Number(feeData.upfront);
        return (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="text-sm font-semibold text-blue-900">Payment Package</span>
                <span className="ml-2 text-xs text-blue-600">
                  {feeData.serviceName} · {feeData.countryName}{feeData.branchName ? ` · ${feeData.branchName}` : ''} · {feeData.currencyCode || 'AED'}
                </span>
              </div>
              <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white shadow">
                {packageLabel}
                <span className="ml-1 opacity-80">
                  {(feeData.currencyCode || 'AED')} {packageTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </span>
            </div>
            <p className="text-xs text-blue-600 mt-2">
              Chosen on the Prospect stage. Go back to Prospect to change the package type.
            </p>
          </div>
        );
      })()}

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h4 className="font-semibold text-lg mb-4 text-gray-900">Line Items</h4>
        <div className="space-y-4">
          {data.items.map((item: any, index: number) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(index, 'description', e.target.value)}
                    className="w-full p-2 border rounded-lg"
                    placeholder="Service description"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit Price</label>
                  <input
                    type="number"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
              </div>
              <div className="mt-2 text-right">
                <span className="text-sm font-medium text-gray-700">Total: {currencyCode} {item.total || '0.00'}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Hidden for now — line items are auto-populated as a single entry
            from the selected program's fee package; re-enable if/when manual
            extra line items are needed again. */}
        {SHOW_ADD_ITEM_BUTTON && (
          <button onClick={addItem} className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            + Add Item
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h4 className="font-semibold text-lg mb-4 text-gray-900">Summary</h4>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span className="font-medium">{currencyCode} {data.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount:</span>
            <span className="font-medium text-red-600">-{currencyCode} {data.discount.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Apply Discount
                {data.discount > 0 && data.subtotal > 0 && (
                  <span className="ml-2 font-normal text-gray-500">
                    ({discountPercent.toFixed(1)}% of package value)
                  </span>
                )}
              </label>
              <input
                type="number"
                min="0"
                max={data.subtotal}
                // Render blank instead of a literal 0 so typing doesn't require
                // deleting a pre-filled zero first — the underlying value stays
                // 0 for calculations until the user actually enters a number.
                value={data.discount || ''}
                onChange={(e) => updateDiscount(e.target.value)}
                disabled={discountLocked}
                className="w-full p-2 border rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="0.00"
              />
              {discountLocked ? (
                <p className="text-xs text-gray-500 mt-1">
                  {retentionData.discountStatus === 'approved'
                    ? 'Discount approved and locked. Changing the amount requires a new approval.'
                    : 'A discount request is pending approval and can\'t be changed until reviewed.'}
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">
                  Cannot exceed the package amount ({currencyCode} {data.subtotal.toFixed(2)}).
                </p>
              )}
            </div>
            <div className="flex items-end gap-3">
              <span className={`px-3 py-2 rounded-lg text-sm font-medium capitalize ${
                discountApproved ? 'bg-green-100 text-green-700' :
                retentionData.discountStatus === 'rejected' ? 'bg-red-100 text-red-700' :
                'bg-yellow-100 text-yellow-700'
              }`}>
                Discount approval: {discountStatusLabel}
              </span>
              {requiresDiscountApproval && discountTier === 'auto' && retentionData.discountStatus !== 'approved' && retentionData.discountStatus !== 'pending' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      onRequestDiscount(isReapplying);
                      setIsReapplying(false);
                    }}
                    disabled={requestingDiscount}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="mr-2" size={16} />
                    {requestingDiscount ? 'Applying...' : isReapplying ? 'Submit Correction' : 'Apply Discount'}
                  </button>
                  <span className="text-xs text-gray-500">0-{tierThresholds.autoMaxPercent}% needs no sign-off</span>
                </div>
              )}
              {requiresDiscountApproval && discountTier !== 'auto' && retentionData.discountStatus !== 'approved' && retentionData.discountStatus !== 'pending' && (
                <button
                  onClick={() => {
                    onRequestDiscount(isReapplying);
                    setIsReapplying(false);
                  }}
                  disabled={requestingDiscount}
                  className="px-4 py-2 bg-[var(--cmg-blue)] text-white rounded-lg hover:bg-[var(--cmg-blue-dark)] flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="mr-2" size={16} />
                  {requestingDiscount ? 'Submitting...' : isReapplying ? 'Submit Correction' : 'Request Approval'}
                </button>
              )}
              {requiresDiscountApproval && discountTier !== 'auto' && retentionData.discountStatus === 'pending' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-yellow-700">
                    Pending Branch Manager or CEO approval. All next opportunity stages are locked until approval.
                  </span>
                  <button
                    onClick={onRefreshDiscount}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center"
                  >
                    <RefreshCw className="mr-2" size={16} />
                    Refresh Status
                  </button>
                </div>
              )}
              {canReapplyDiscount && !isReapplying && !canEditLockedDiscount && (
                <button
                  onClick={() => setIsReapplying(true)}
                  className="px-4 py-2 border border-amber-300 bg-white text-amber-700 rounded-lg hover:bg-amber-50 flex items-center text-sm font-medium"
                  title="Use this if the discount amount was entered wrong, or the wrong amount got approved/rejected"
                >
                  <RefreshCw className="mr-2" size={14} />
                  Amount wrong? Request a correction
                </button>
              )}
              {isReapplying && (
                <button
                  onClick={async () => {
                    setIsReapplying(false);
                    // Restore the real, still-approved amount/status from the
                    // database in case the field was edited but never submitted.
                    await onRefreshDiscount?.();
                  }}
                  className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel correction
                </button>
              )}
            </div>
          </div>
          <div className="flex justify-between">
            <span>Tax ({(vatInfo.rate * 100).toFixed(0)}% {vatInfo.label}):</span>
            <span className="font-medium">{currencyCode} {data.tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold border-t pt-2">
            <span>Total:</span>
            <span className="text-blue-600">{currencyCode} {data.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <button
          onClick={onPrevious}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 flex items-center font-medium"
        >
          <ChevronLeft className="mr-2" size={20} />
          Back to Prospect
        </button>
        <div className="flex gap-3">
          <button
            onClick={onNext}
            disabled={!discountApproved}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center font-medium"
          >
            Continue to Payment
            <ChevronRight className="ml-2" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
