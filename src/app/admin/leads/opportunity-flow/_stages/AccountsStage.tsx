'use client';

import { useState, useEffect } from 'react';
import { getLeadBranchDetails, printReceipt } from '@/lib/receiptTemplate';
import { Download, CheckCircle, XCircle, Clock, AlertCircle, FileText, ChevronRight, ChevronLeft, Receipt, RefreshCw } from 'lucide-react';

export default function AccountsStage({ lead, leadId, opportunityId, onNext, onPrevious }: any) {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [printingId, setPrintingId] = useState<number | null>(null);

  const fetchPayments = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      let resolvedOpportunityId = Number(opportunityId || lead?.opportunity_id || 0) || null;
      if (!resolvedOpportunityId) {
        const oppRes = await fetch(`/api/opportunities?leadId=${leadId}&_=${Date.now()}`, { cache: 'no-store' });
        const opps = await oppRes.json();
        const opp = Array.isArray(opps) ? opps[0] : null;
        resolvedOpportunityId = opp?.id ? Number(opp.id) : null;
      }
      if (!resolvedOpportunityId) {
        setPayments([]);
        return;
      }

      const payRes = await fetch(`/api/opportunity-payments?opportunityId=${resolvedOpportunityId}&_=${Date.now()}`, { cache: 'no-store' });
      const pays = await payRes.json();
      const list = Array.isArray(pays) ? pays : pays.data || [];

      // Keep the wizard in sync with the Accounts team's verification screen:
      // both `accountantStatus` and `status` have been used historically for
      // review state, and receiptNumber is often stored as paymentNumber.
      setPayments(list.map((p: any) => ({
        ...p,
        accountantStatus: p.accountantStatus || (p.status === 'verified' || p.status === 'rejected' ? p.status : 'pending'),
        receiptNumber: p.receiptNumber || p.paymentNumber,
        paidAmount: p.paidAmount ?? p.amount ?? 0,
        remainingBalance: p.remainingBalance ?? p.balanceAmount ?? 0,
      })));
    } catch (err) {
      console.error('Error fetching payments:', err);
    } finally {
      setLoading(false);
      if (isManualRefresh) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, opportunityId]);

  const printReceiptPDF = (p: any) => {
    setPrintingId(p.id);
    const branchDetails = getLeadBranchDetails(lead as any);
    printReceipt({
      receiptNumber: p.receiptNumber,
      paymentNumber: p.paymentNumber,
      paymentDate: p.paymentDate,
      clientName: p.clientName || (lead as any)?.client_actual_name || `${lead?.fname || ''} ${lead?.lname || ''}`.trim(),
      email: p.clientEmail || lead?.email,
      phone: p.clientPhone || lead?.mobile || lead?.phone,
      passportNumber: (lead as any)?.id_number || '',
      agreementNumber: p.agreementNumber,
      opportunityId,
      serviceName: p.serviceName || (lead as any)?.service_interest_label || lead?.service_interest,
      consultantName: p.consultantName,
      companyName: p.companyName || branchDetails.companyName,
      branchName: p.branchName || branchDetails.branchName,
      branchAddress: p.branchAddress || branchDetails.branchAddress,
      branchEmail: p.branchEmail || branchDetails.branchEmail,
      branchPhone: p.branchPhone || branchDetails.branchPhone,
      branchAbbrv: branchDetails.branchAbbrv,
      licenseNumber: branchDetails.licenseNumber,
      vatGstPercent: branchDetails.vatGstPercent,
      paymentMethod: p.paymentMethod,
      transactionId: p.transactionId,
      currency: p.currency,
      totalAmount: p.totalAmount,
      paidAmount: p.paidAmount,
      remainingBalance: p.remainingBalance ?? p.balanceAmount,
      remark: p.remark,
      adminFeeIncluded: p.adminFeeIncluded,
      adminFeeAmount: p.adminFeeAmount,
      includeVat: p.includeVat,
      installments: p.installmentPlan,
    });
    setPrintingId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading payment data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Receipt className="mr-3 text-blue-600" size={28} />
          <div>
            <h3 className="text-2xl font-bold text-gray-900">Accounts Verification</h3>
            <p className="text-gray-600 text-sm">Read-only status — reviewed by the Accounts team, not from this wizard</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchPayments(true)}
            disabled={refreshing}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2 font-medium disabled:opacity-60"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {payments.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <AlertCircle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
          <p className="text-yellow-800 font-medium">No payment records found</p>
          <p className="text-yellow-600 text-sm mt-1">Complete the payment stage first before accounts verification.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {payments.map((p: any) => (
            <div key={p.id} className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="font-semibold text-lg text-gray-900">{p.paymentNumber || `Payment #${p.id}`}</h4>
                  <p className="text-sm text-gray-500">{p.clientName || lead?.fname + ' ' + lead?.lname || 'N/A'} — {p.serviceName || 'Service'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex px-3 py-1.5 text-sm font-medium rounded-full ${
                    p.accountantStatus === 'verified' ? 'bg-green-100 text-green-800 border border-green-300' :
                    p.accountantStatus === 'rejected' ? 'bg-red-100 text-red-800 border border-red-300' :
                    'bg-yellow-100 text-yellow-800 border border-yellow-300'
                  }`}>
                    {p.accountantStatus === 'verified' && <CheckCircle className="w-4 h-4 mr-1" />}
                    {p.accountantStatus === 'rejected' && <XCircle className="w-4 h-4 mr-1" />}
                    {(p.accountantStatus === 'pending' || !p.accountantStatus) && <Clock className="w-4 h-4 mr-1" />}
                    {(p.accountantStatus || 'pending').charAt(0).toUpperCase() + (p.accountantStatus || 'pending').slice(1)}
                  </span>
                  {p.accountantStatus === 'verified' && (
                    <button
                      onClick={() => printReceiptPDF(p)}
                      disabled={printingId === p.id}
                      className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs hover:bg-green-800 flex items-center gap-1.5 disabled:opacity-60"
                    >
                      <Download size={13} /> {printingId === p.id ? 'Opening…' : 'Download Receipt PDF'}
                    </button>
                  )}
                  {p.accountantStatus === 'verified' && p.opportunityId && (
                    <button
                      onClick={() => window.open(`/admin/leads/receipt/${p.opportunityId}`, '_blank')}
                      className="px-3 py-1.5 border border-green-700 text-green-700 rounded-lg text-xs hover:bg-green-50 flex items-center gap-1.5"
                    >
                      <FileText size={13} /> Open Receipt Page
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-xs text-gray-500 uppercase">Total Amount</span>
                  <p className="text-lg font-bold text-gray-900">{p.currency || 'AED'} {(p.totalAmount || 0).toLocaleString()}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <span className="text-xs text-green-600 uppercase">Paid Amount</span>
                  <p className="text-lg font-bold text-green-700">{p.currency || 'AED'} {(p.paidAmount || 0).toLocaleString()}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <span className="text-xs text-blue-600 uppercase">Payment Method</span>
                  <p className="text-lg font-bold text-blue-700 capitalize">{(p.paymentMethod || 'N/A').replace('_', ' ')}</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3">
                  <span className="text-xs text-purple-600 uppercase">Payment Status</span>
                  <p className="text-lg font-bold text-purple-700 capitalize">{p.status || 'N/A'}</p>
                </div>
              </div>

              {p.proofOfPaymentUrl && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800">Proof of Payment: {p.proofOfPaymentUrl.split('/').pop()}</span>
                  </div>
                </div>
              )}

              {p.accountantRemarks && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <span className="text-xs text-blue-600 uppercase font-medium">Accountant Remarks</span>
                  <p className="text-sm text-blue-800 mt-1">{p.accountantRemarks}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center">
          <AlertCircle className="mr-2 text-blue-600" size={20} />
          <span className="text-sm text-blue-800">The Accounts team must verify or reject the payment (via Accounts Verification) before this can proceed to compliance review.</span>
        </div>
      </div>

      <div className="flex justify-between">
        <button onClick={onPrevious} className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 flex items-center font-medium">
          <ChevronLeft className="mr-2" size={20} />
          Back to Payment
        </button>
        <button
          onClick={onNext}
          disabled={payments.length > 0 && payments.every((p: any) => p.accountantStatus !== 'verified')}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center font-medium"
        >
          Continue to Documents
          <ChevronRight className="ml-2" size={20} />
        </button>
      </div>
    </div>
  );
}
