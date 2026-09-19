'use client';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface ContractWizardProps {
  leadId: number;
  onContractGenerated: (contractId: number) => void;
}

interface LookupOption {
  id: number;
  name: string;
}

interface ExistingContractAgreement {
  id: number;
  agreementNumber: string;
  status: string;
  documentUrl: string | null;
}

interface ExistingContractReceipt {
  id: number;
  receiptNumber: string;
  amount: string | number;
  paymentDate: string;
}

interface ExistingContract {
  id: number;
  contractNumber: string;
  opportunityId: number;
  branchId: number;
  serviceId: number | null;
  currency: string;
  payTotal: string | number;
  discount: string | number;
  paidYet: string | number;
  payBalance: string | number;
  status: string;
  createdAt: string;
  agreements?: ExistingContractAgreement[];
  receipts?: ExistingContractReceipt[];
  dmBranch?: { id: number; name: string };
  counselor?: { id: number; name: string } | null;
}

// Rebuilt from a previously non-functional mock (every dropdown was hardcoded
// fake data, "Existing Contracts" never actually loaded, and "Generate
// Contract" fabricated a random success id). Now creates a real CrmContract
// row + its Agreement + an optional first Receipt via POST /api/admin/contracts
// — "add a new product to an existing client", independent of any other
// contract that lead already has, each with its own branch/service/payment.
export default function ContractWizard({ leadId, onContractGenerated }: ContractWizardProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const [contractData, setContractData] = useState({
    countryInterest: '',
    serviceId: '',
    programTypeId: '',
    contractType: 'individual',
    branchId: '',
    counselorId: '',
    totalAmount: '',
    discountAmount: '0',
    durationMonths: '12',
    startDate: '',
    specialTerms: '',
  });

  const [initialPaymentEnabled, setInitialPaymentEnabled] = useState(false);
  const [initialPayment, setInitialPayment] = useState({
    amount: '',
    paymentMethod: 'cash',
    transactionId: '',
    notes: '',
  });

  const [discountStatus, setDiscountStatus] = useState<'none' | 'pending' | 'approved'>('none');
  const [requestingDiscount, setRequestingDiscount] = useState(false);

  const [countries, setCountries] = useState<LookupOption[]>([]);
  const [services, setServices] = useState<LookupOption[]>([]);
  const [programTypes, setProgramTypes] = useState<LookupOption[]>([]);
  const [branches, setBranches] = useState<LookupOption[]>([]);
  const [counselors, setCounselors] = useState<LookupOption[]>([]);

  const [contracts, setContracts] = useState<ExistingContract[]>([]);
  const [lastResult, setLastResult] = useState<{ contractNumber: string; agreementNumber: string; receiptNumber: string | null } | null>(null);

  const loadContracts = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/contracts?leadId=${leadId}`);
      if (response.ok) {
        const data = await response.json();
        setContracts(data.contracts || []);
      }
    } catch (error) {
      console.error('Error loading existing contracts:', error);
    }
  }, [leadId]);

  useEffect(() => {
    (async () => {
      try {
        const [countriesRes, branchesRes] = await Promise.all([
          fetch('/api/countries'),
          fetch('/api/branches?limit=200&status=1'),
        ]);
        if (countriesRes.ok) setCountries(await countriesRes.json());
        if (branchesRes.ok) {
          const branchData = await branchesRes.json();
          setBranches((branchData.branches || []).map((b: { id: number; branch?: string; name?: string }) => ({ id: b.id, name: b.branch || b.name || `Branch #${b.id}` })));
        }
      } catch (error) {
        console.error('Error loading lookup data:', error);
      } finally {
        setLoading(false);
      }
    })();
    loadContracts();
  }, [leadId, loadContracts]);

  // Service is scoped to the selected country, same Country -> Program
  // dependency used by the Add Lead form and the Opportunity Flow wizard.
  useEffect(() => {
    if (!contractData.countryInterest) {
      setServices([]);
      return;
    }
    (async () => {
      try {
        const response = await fetch(`/api/country-programs?countryId=${contractData.countryInterest}`);
        setServices(response.ok ? await response.json() : []);
      } catch (error) {
        console.error('Error loading services:', error);
        setServices([]);
      }
    })();
  }, [contractData.countryInterest]);

  useEffect(() => {
    if (!contractData.countryInterest || !contractData.serviceId) {
      setProgramTypes([]);
      return;
    }
    (async () => {
      try {
        const response = await fetch(`/api/program-types?countryId=${contractData.countryInterest}&programId=${contractData.serviceId}`);
        setProgramTypes(response.ok ? await response.json() : []);
      } catch (error) {
        console.error('Error loading program types:', error);
        setProgramTypes([]);
      }
    })();
  }, [contractData.countryInterest, contractData.serviceId]);

  useEffect(() => {
    if (!contractData.branchId) {
      setCounselors([]);
      return;
    }
    (async () => {
      try {
        const response = await fetch(`/api/employees/active?role=counsellor&branch=${contractData.branchId}`);
        setCounselors(response.ok ? await response.json() : []);
      } catch (error) {
        console.error('Error loading counselors:', error);
        setCounselors([]);
      }
    })();
  }, [contractData.branchId]);

  const handleNext = () => setCurrentStep((s) => s + 1);
  const handlePrevious = () => setCurrentStep((s) => s - 1);

  const handleInputChange = (field: string, value: string) => {
    setContractData((prev) => ({ ...prev, [field]: value }));
    if (field === 'countryInterest') setContractData((prev) => ({ ...prev, serviceId: '', programTypeId: '' }));
    if (field === 'serviceId') setContractData((prev) => ({ ...prev, programTypeId: '' }));
    if (field === 'discountAmount') setDiscountStatus('none');
  };

  const requestDiscountApproval = async () => {
    const discount = Number(contractData.discountAmount) || 0;
    const total = Number(contractData.totalAmount) || 0;
    if (discount <= 0) return;
    setRequestingDiscount(true);
    try {
      const response = await fetch('/api/discount-approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          discountType: 'fixed',
          discountAmount: discount,
          originalAmount: total,
          discountedAmount: total - discount,
          currency: 'AED',
          reason: `Discount requested while adding a new contract for lead #${leadId}`,
          requestedBy: user?.id || 1,
          status: 'pending',
        }),
      });
      if (response.ok) {
        const result = await response.json();
        const resolvedStatus: 'pending' | 'approved' = result.data?.status === 'approved' ? 'approved' : 'pending';
        setDiscountStatus(resolvedStatus);
        window.toast.success(
          resolvedStatus === 'approved'
            ? 'Discount applied — auto-approved (0-20%), no sign-off needed.'
            : 'Discount request submitted. A Branch Manager or CEO must approve it in Discount Management before this contract can be created.'
        );
      } else {
        const errorBody = await response.json().catch(() => null);
        window.toast.error(errorBody?.error || 'Failed to submit discount request');
      }
    } catch (error) {
      console.error('Error requesting discount:', error);
      window.toast.error('Error requesting discount approval');
    } finally {
      setRequestingDiscount(false);
    }
  };

  const generateContract = async () => {
    const discount = Number(contractData.discountAmount) || 0;
    if (discount > 0 && discountStatus !== 'approved') {
      window.toast.error('This discount needs Branch Manager or CEO approval before the contract can be created.');
      return;
    }
    if (!contractData.branchId || !Number(contractData.totalAmount)) {
      window.toast.error('Branch and a total amount are required.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/admin/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          branchId: Number(contractData.branchId),
          countryInterest: contractData.countryInterest ? Number(contractData.countryInterest) : null,
          serviceId: contractData.serviceId ? Number(contractData.serviceId) : null,
          programTypeId: contractData.programTypeId ? Number(contractData.programTypeId) : null,
          contractType: contractData.contractType,
          counselorId: contractData.counselorId ? Number(contractData.counselorId) : null,
          totalAmount: Number(contractData.totalAmount),
          discountAmount: discount,
          durationMonths: Number(contractData.durationMonths) || 12,
          startDate: contractData.startDate || undefined,
          specialTerms: contractData.specialTerms,
          initialPayment: initialPaymentEnabled && Number(initialPayment.amount) > 0 ? {
            amount: Number(initialPayment.amount),
            paymentMethod: initialPayment.paymentMethod,
            transactionId: initialPayment.transactionId || undefined,
            notes: initialPayment.notes || undefined,
          } : undefined,
        }),
      });

      const result = await response.json();
      if (response.ok) {
        setLastResult({
          contractNumber: result.contract?.contractNumber || '',
          agreementNumber: result.agreement?.agreementNumber || '',
          receiptNumber: result.receipt?.receiptNumber || null,
        });
        onContractGenerated(result.contractId);
        await loadContracts();
        setCurrentStep(4);
      } else {
        window.toast.error(result.error || 'Failed to generate contract');
      }
    } catch (error) {
      console.error('Error generating contract:', error);
      window.toast.error('Failed to generate contract. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const recordAdditionalReceipt = async (contractId: number) => {
    const amountStr = window.prompt('Amount received:');
    if (!amountStr) return;
    const amount = Number(amountStr);
    if (!amount || amount <= 0) {
      window.toast.error('Enter a positive amount.');
      return;
    }
    try {
      const response = await fetch(`/api/contracts/${contractId}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, paymentMethod: 'cash' }),
      });
      const result = await response.json();
      if (response.ok) {
        window.toast.success(`Receipt ${result.receiptNumber} recorded.`);
        await loadContracts();
      } else {
        window.toast.error(result.error || 'Failed to record receipt');
      }
    } catch (error) {
      console.error('Error recording receipt:', error);
      window.toast.error('Failed to record receipt');
    }
  };

  const branchName = (branchId: number) => branches.find((b) => b.id === branchId)?.name || `Branch #${branchId}`;

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Step 1: Program & Branch</h2>
            <div className="bg-white rounded-lg shadow p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Contract Type</label>
                  <SearchableSelect
                    value={contractData.contractType}
                    onChange={(e) => handleInputChange('contractType', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="individual">Individual</option>
                    <option value="family">Family</option>
                    <option value="student">Student</option>
                    <option value="business">Business</option>
                  </SearchableSelect>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Destination Country</label>
                  <SearchableSelect
                    value={contractData.countryInterest}
                    onChange={(e) => handleInputChange('countryInterest', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select country</option>
                    {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </SearchableSelect>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Service</label>
                  <SearchableSelect
                    value={contractData.serviceId}
                    onChange={(e) => handleInputChange('serviceId', e.target.value)}
                    disabled={!contractData.countryInterest}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select service</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </SearchableSelect>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Program Type</label>
                  <SearchableSelect
                    value={contractData.programTypeId}
                    onChange={(e) => handleInputChange('programTypeId', e.target.value)}
                    disabled={!contractData.serviceId}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select program type</option>
                    {programTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </SearchableSelect>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Branch</label>
                  <SearchableSelect
                    value={contractData.branchId}
                    onChange={(e) => handleInputChange('branchId', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select branch</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </SearchableSelect>
                  <p className="mt-1 text-xs text-gray-500">This contract&rsquo;s own branch — it can be different from the lead&rsquo;s home branch.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Counselor</label>
                  <SearchableSelect
                    value={contractData.counselorId}
                    onChange={(e) => handleInputChange('counselorId', e.target.value)}
                    disabled={!contractData.branchId}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select counselor</option>
                    {counselors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </SearchableSelect>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleNext}
                disabled={!contractData.branchId}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                Next Step
              </button>
            </div>
          </div>
        );

      case 2: {
        const total = Number(contractData.totalAmount) || 0;
        const discount = Number(contractData.discountAmount) || 0;
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Step 2: Financial Details</h2>
            <div className="bg-white rounded-lg shadow p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Total Amount</label>
                  <input
                    type="number"
                    value={contractData.totalAmount}
                    onChange={(e) => handleInputChange('totalAmount', e.target.value)}
                    min="0"
                    step="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Duration (months)</label>
                  <input
                    type="number"
                    value={contractData.durationMonths}
                    onChange={(e) => handleInputChange('durationMonths', e.target.value)}
                    min="1"
                    max="60"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Discount Amount</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={contractData.discountAmount}
                    onChange={(e) => handleInputChange('discountAmount', e.target.value)}
                    min="0"
                    step="1"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {discount > 0 && discountStatus !== 'approved' && (
                    <button
                      onClick={requestDiscountApproval}
                      disabled={requestingDiscount}
                      className="whitespace-nowrap bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
                    >
                      {requestingDiscount ? 'Requesting…' : 'Request Approval'}
                    </button>
                  )}
                  {discount > 0 && discountStatus === 'approved' && (
                    <span className="whitespace-nowrap inline-flex items-center px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium">Approved</span>
                  )}
                  {discount > 0 && discountStatus === 'pending' && (
                    <span className="whitespace-nowrap inline-flex items-center px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-sm font-medium">Pending sign-off</span>
                  )}
                </div>
                {discount > 0 && (
                  <p className="mt-1 text-xs text-gray-500">Net payable after discount: {(total - discount).toLocaleString()}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Special Terms</label>
                <textarea
                  value={contractData.specialTerms}
                  onChange={(e) => handleInputChange('specialTerms', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter any special terms and conditions..."
                />
              </div>
            </div>
            <div className="flex justify-between">
              <button onClick={handlePrevious} className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition-colors">Previous</button>
              <button onClick={handleNext} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">Next Step</button>
            </div>
          </div>
        );
      }

      case 3:
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Step 3: Initial Payment</h2>
            <div className="bg-white rounded-lg shadow p-6 space-y-6">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={initialPaymentEnabled}
                  onChange={(e) => setInitialPaymentEnabled(e.target.checked)}
                />
                Record a payment now
              </label>
              {initialPaymentEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Amount Received</label>
                    <input
                      type="number"
                      value={initialPayment.amount}
                      onChange={(e) => setInitialPayment((prev) => ({ ...prev, amount: e.target.value }))}
                      min="0"
                      step="1"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
                    <SearchableSelect
                      value={initialPayment.paymentMethod}
                      onChange={(e) => setInitialPayment((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                    </SearchableSelect>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Reference / Transaction ID</label>
                    <input
                      type="text"
                      value={initialPayment.transactionId}
                      onChange={(e) => setInitialPayment((prev) => ({ ...prev, transactionId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700 space-y-1">
                <p><span className="font-medium">Branch:</span> {contractData.branchId ? branchName(Number(contractData.branchId)) : '—'}</p>
                <p><span className="font-medium">Total Amount:</span> {Number(contractData.totalAmount || 0).toLocaleString()}</p>
                <p><span className="font-medium">Discount:</span> {Number(contractData.discountAmount || 0).toLocaleString()}</p>
                <p><span className="font-medium">Initial Payment:</span> {initialPaymentEnabled ? Number(initialPayment.amount || 0).toLocaleString() : '0'}</p>
              </div>
            </div>
            <div className="flex justify-between">
              <button onClick={handlePrevious} className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition-colors">Previous</button>
              <button
                onClick={generateContract}
                disabled={submitting}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Generating…' : 'Generate Contract'}
              </button>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
              <div className="mb-4">
                <div className="text-green-800">
                  <svg className="w-16 h-16 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-green-800 mb-2">Contract Generated Successfully!</h3>
                {lastResult && (
                  <div className="text-green-700 mb-4 space-y-1 text-sm">
                    <p>Contract: <span className="font-semibold">{lastResult.contractNumber}</span></p>
                    <p>Agreement: <span className="font-semibold">{lastResult.agreementNumber}</span></p>
                    {lastResult.receiptNumber && <p>Receipt: <span className="font-semibold">{lastResult.receiptNumber}</span></p>}
                  </div>
                )}
              </div>
              <div className="flex justify-center space-x-4">
                <button
                  onClick={() => {
                    setCurrentStep(1);
                    setContractData((prev) => ({ ...prev, totalAmount: '', discountAmount: '0', specialTerms: '' }));
                    setInitialPaymentEnabled(false);
                    setDiscountStatus('none');
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Add Another Contract
                </button>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-gray-900">Add Contract</h1>
            <span className="text-sm text-gray-600">Lead ID: #{leadId}</span>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex space-x-2">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${step === currentStep ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'}`}
                  >
                    {step}
                  </div>
                ))}
              </div>
              <div className="text-sm text-gray-600">Step {currentStep} of 4</div>
            </div>
          </div>

          <div className="bg-white rounded-lg p-6">
            {renderStep()}
          </div>

          {contracts.length > 0 && (
            <div className="mt-8">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Existing Contracts for This Lead</h3>
              <div className="bg-white rounded-lg shadow overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contract #</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Branch</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total / Paid / Balance</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agreement</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {contracts.map((contract) => {
                      const agreement = contract.agreements?.[0];
                      return (
                        <tr key={contract.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{contract.contractNumber}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{contract.dmBranch?.name || branchName(contract.branchId)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {contract.currency} {Number(contract.payTotal).toLocaleString()} / {Number(contract.paidYet).toLocaleString()} / {Number(contract.payBalance).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 capitalize">{contract.status}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {agreement ? (
                              agreement.documentUrl ? (
                                <a href={agreement.documentUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">{agreement.agreementNumber}</a>
                              ) : (
                                <span className="text-gray-700">{agreement.agreementNumber}</span>
                              )
                            ) : '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3">
                            {Number(contract.payBalance) > 0 && (
                              <button onClick={() => recordAdditionalReceipt(contract.id)} className="text-blue-600 hover:text-blue-800">
                                Record Payment
                              </button>
                            )}
                            <a
                              href={`/admin/leads/opportunity-flow?leadId=${leadId}&opportunityId=${contract.opportunityId}`}
                              className="text-gray-600 hover:text-gray-800"
                              title="Upload the signed agreement and submit this contract for finance/compliance sign-off"
                            >
                              Continue in Opportunity Flow
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
