'use client';

import dynamic from 'next/dynamic';
import { localToday } from '@/lib/dubaiDate';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lead } from '@/types/lead';
import { useAuth } from '@/contexts/AuthContext';
import { getLeadBranchDetails } from '@/lib/receiptTemplate';
import { validatePlan } from '@/lib/installments';
import { CheckCircle, XCircle, FileText, User, DollarSign, FileSignature, Shield, ChevronRight, ChevronLeft, Mail, Phone, Globe, Target, Briefcase, Receipt, FolderOpen, PenTool, Lock } from 'lucide-react';
import { FlowStage, ProspectData, QuotationData, PaymentData, DocumentData, AgreementData, SignedAgreementData, RetentionData, COUNSELOR_SUMMARY_MIN_CHARS } from './opportunity-flow/_stages/types';

// Each stage is its own chunk, downloaded when the counselor reaches it.
const StageLoading = () => (
  <div className="flex items-center justify-center py-16 text-gray-500" role="status">
    <div className="mr-3 h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" /> Loading stage…
  </div>
);
const stageLoaders = {
  ProspectStage: () => import('./opportunity-flow/_stages/ProspectStage'),
  QuotationStage: () => import('./opportunity-flow/_stages/QuotationStage'),
  PaymentStage: () => import('./opportunity-flow/_stages/PaymentStage'),
  AccountsStage: () => import('./opportunity-flow/_stages/AccountsStage'),
  DocumentsStage: () => import('./opportunity-flow/_stages/DocumentsStage'),
  AgreementStage: () => import('./opportunity-flow/_stages/AgreementStage'),
  SignedAgreementStage: () => import('./opportunity-flow/_stages/SignedAgreementStage'),
  RetainedStage: () => import('./opportunity-flow/_stages/RetainedStage'),
  RetentionRejectedStage: () => import('./opportunity-flow/_stages/RetentionRejectedStage'),
  ClosedStage: () => import('./opportunity-flow/_stages/ClosedStage'),
};
const ProspectStage = dynamic(stageLoaders.ProspectStage, { loading: StageLoading });
const QuotationStage = dynamic(stageLoaders.QuotationStage, { loading: StageLoading });
const PaymentStage = dynamic(stageLoaders.PaymentStage, { loading: StageLoading });
const AccountsStage = dynamic(stageLoaders.AccountsStage, { loading: StageLoading });
const DocumentsStage = dynamic(stageLoaders.DocumentsStage, { loading: StageLoading });
const AgreementStage = dynamic(stageLoaders.AgreementStage, { loading: StageLoading });
const SignedAgreementStage = dynamic(stageLoaders.SignedAgreementStage, { loading: StageLoading });
const RetainedStage = dynamic(stageLoaders.RetainedStage, { loading: StageLoading });
const RetentionRejectedStage = dynamic(stageLoaders.RetentionRejectedStage, { loading: StageLoading });
const ClosedStage = dynamic(stageLoaders.ClosedStage, { loading: StageLoading });


interface OpportunityFlowWizardProps {
  leadId: number;
  onFlowComplete?: () => void;
  /** Deep-link straight to a stage id (e.g. 'payment') instead of always starting at 'prospect'. */
  initialStage?: string;
  initialOpportunityId?: number;
}

const stepVariants = {
  hidden: { opacity: 0, x: 50 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -50 }
};

const FLOW_STAGE_IDS = ['prospect', 'quotation', 'payment', 'accounts', 'documents', 'agreement', 'signed-agreement', 'retained', 'retention-rejected', 'closed'];

// Agreement expiry is the service's own validity period (crm_service.validity,
// e.g. "18 Months" for Canada/Australia vs "6 Months" for a visit visa)
// counted from the start date, instead of a flat one-year default that
// under-counts the longer immigration programs.
const computeAgreementEndDate = (startDate: string, programValidity?: string | null): string => {
  const validityMonths = parseInt(String(programValidity || ''), 10) || 12;
  const endDateObj = startDate ? new Date(`${startDate}T00:00:00`) : new Date();
  endDateObj.setMonth(endDateObj.getMonth() + validityMonths);
  return endDateObj.toISOString().split('T')[0];
};

export default function OpportunityFlowWizard({ leadId, initialStage, initialOpportunityId }: OpportunityFlowWizardProps) {
  const resolvedInitialStage = initialStage && FLOW_STAGE_IDS.includes(initialStage) ? initialStage : 'prospect';
  const { user, currencyCode } = useAuth();
  const [activeStage, setActiveStage] = useState<string>(resolvedInitialStage);
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [completedOpportunityId, setCompletedOpportunityId] = useState<number | null>(initialOpportunityId || null);
  // Opportunity flow is always editable, even once a deal is marked
  // won/retained — locking it to view-only for non-CEO/BM roles blocked
  // counselors from a deal they'd just closed, before Finance/Compliance
  // had even reviewed it.
  const isReadOnly = false;
  const getComplianceApprovalsUrl = (opportunityId?: number | null) => {
    const params = new URLSearchParams({ leadId: String(leadId) });
    if (opportunityId) params.set('opportunityId', String(opportunityId));
    return `/api/opportunity-compliance-approvals?${params.toString()}`;
  };

  // State for each stage
  const [prospectData, setProspectData] = useState<ProspectData>({
    opportunityName: '',
    opportunityType: 'new_business',
    estimatedValue: '',
    priority: 'medium',
    description: '',
    serviceRequired: '',
    serviceId: ''
  });

  // ── Fee lookup state ──
  interface FeeRecord {
    id: number;
    service: number | null;
    country: number | null;
    branch: number | null;
    currency: number | null;
    currencyCode: string;
    serviceName: string;
    countryName: string;
    branchName: string;
    upfront: number;
    prof_fee: number;
    firstMonth: number;
    secondMonth: number;
    thirdMonth: number;
    prof_fee_month: number;
    firstStage: number;
    secondStage: number;
    thirdStage: number;
    forthStage: number;
    fifthStage: number;
    prof_fee_stage: number;
    premium_fee_1: number;
    premium_fee_2: number;
  }
  const [feeData, setFeeData] = useState<FeeRecord | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);

  const [quotationData, setQuotationData] = useState<QuotationData>({
    quotationNumber: '',
    validUntil: '',
    items: [{
      description: '',
      quantity: 1,
      unitPrice: '',
      total: ''
    }],
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
    terms: ''
  });

  const [paymentData, setPaymentData] = useState<PaymentData>({
    paymentStructure: 'full',
    totalAmount: 0,
    paidAmount: 0,
    remainingBalance: 0,
    paymentMethod: 'cash',
    transactionId: '',
    paymentDate: localToday(),
    proofOfPayment: null,
    proofOfPaymentUrl: null,
    dueDate: '',
    remark: '',
    adminFeeIncluded: false,
    includeVat: true,
    installments: [],
  });

  const [documentData, setDocumentData] = useState<DocumentData>({
    idProof: null,
    passportCopy: null,
    passportNumber: '',
    clientActualName: '',
    additionalInfo: '',
    allMandatoryDocsUploaded: false,
    uploadedDocUrls: {}
  });

  const [agreementData, setAgreementData] = useState<AgreementData>({
    agreementId: null,
    agreementType: 'service_agreement',
    agreementTitle: '',
    duration: '',
    startDate: '',
    endDate: '',
    amount: '',
    terms: '',
    specialConditions: '',
    status: 'draft',
    companyName: '',
    companyAddress: '',
    counselorConversationSummary: ''
  });

  const [signedAgreementData, setSignedAgreementData] = useState<SignedAgreementData>({
    clientSignature: '',
    signatureDate: '',
    documentUrl: '',
    uploadedTocrm: false
  });

  const [retentionData, setRetentionData] = useState<RetentionData>({
    retentionStatus: 'pending',
    complianceManager: '',
    reviewNotes: '',
    reviewDate: '',
    discountApprovalId: null,
    discountStatus: 'not_required',
    complianceApprovalId: null,
    agreementComplianceStatus: 'not_submitted',
    reassignmentId: null,
    notes: ''
  });
  const [requestingDiscount, setRequestingDiscount] = useState(false);
  const [closingWon, setClosingWon] = useState(false);
  // crm_opportunity_workflow_reviews (Accounts/finance + CRM Compliance sign-off) -
  // a separate gate from retentionData.agreementComplianceStatus above. A
  // rejection here must block forward progress even if this wizard was
  // deep-linked straight to a later stage (e.g. the Clients tab's "Edit
  // opportunity flow" button), since a stale opportunity_status of 'won' set
  // at conversion time doesn't get corrected when Accounts/Compliance later
  // reject the same opportunity - see CLIENT_STATUS_SQL in api/leads/route.ts.
  const [financeReviewStatus, setFinanceReviewStatus] = useState<{ financeStatus: string | null; complianceStatus: string | null } | null>(null);
  const isFinanceOrComplianceRejected = financeReviewStatus?.financeStatus === 'rejected' || financeReviewStatus?.complianceStatus === 'rejected';

  const [stages, setStages] = useState<FlowStage[]>(() => {
    const baseStages: FlowStage[] = [
      { id: 'prospect', name: 'Prospect', description: 'Initial opportunity identification', icon: Target, status: 'pending' },
      { id: 'quotation', name: 'Quotation', description: 'Generate and send quotation', icon: FileText, status: 'pending' },
      { id: 'payment', name: 'Payment', description: 'Process payment', icon: DollarSign, status: 'pending' },
      { id: 'accounts', name: 'Accounts', description: 'Payment verification', icon: Receipt, status: 'pending' },
      { id: 'documents', name: 'Documents', description: 'Upload required documents', icon: FolderOpen, status: 'pending' },
      { id: 'agreement', name: 'Agreement', description: 'Generate agreement', icon: PenTool, status: 'pending' },
      { id: 'signed-agreement', name: 'Signed Agreement', description: 'Upload signed agreement', icon: FileSignature, status: 'pending' },
      { id: 'retained', name: 'Retained', description: 'Compliance review', icon: Shield, status: 'pending' },
      { id: 'retention-rejected', name: 'Retention Review', description: 'Retention status', icon: Lock, status: 'pending' },
      { id: 'closed', name: 'Closed', description: 'Opportunity closed', icon: CheckCircle, status: 'pending' }
    ];
    // Deep-linking (e.g. from Balance Payments' "Make Payment" button) can land
    // on a stage past 'prospect' — mark everything before it as completed so
    // the stage nav doesn't look like earlier steps were skipped/broken.
    const targetIndex = baseStages.findIndex((s) => s.id === resolvedInitialStage);
    return baseStages.map((s, idx) => ({
      ...s,
      status: idx < targetIndex ? 'completed' : idx === targetIndex ? 'current' : 'pending',
    }));
  });

  // Jumps the stage nav straight to `stageId`, marking everything before it
  // completed — used both for the initialStage deep-link case above and to
  // resume at the lead's persisted opportunity_stage on load (see fetchLeadData).
  const applyStageProgress = (stageId: string) => {
    const targetIndex = FLOW_STAGE_IDS.indexOf(stageId);
    if (targetIndex < 0) return;
    setStages(prev => prev.map((s, idx) => ({
      ...s,
      status: idx < targetIndex ? 'completed' : idx === targetIndex ? 'current' : 'pending',
    })));
    setActiveStage(stageId);
  };

  const applyComplianceStatusToStages = (status: RetentionData['agreementComplianceStatus']) => {
    if (status === 'approved') {
      setStages(prev => prev.map(stage => {
        if (stage.id === 'retained') return { ...stage, status: 'current' as const };
        if (stage.id === 'retention-rejected') return { ...stage, status: 'pending' as const };
        return stage;
      }));
      return;
    }

    if (status === 'rejected') {
      setStages(prev => prev.map(stage => {
        if (stage.id === 'retained') return { ...stage, status: 'rejected' as const };
        if (stage.id === 'retention-rejected') return { ...stage, status: 'current' as const };
        return stage;
      }));
      setActiveStage('retention-rejected');
    }
  };

  useEffect(() => {
    const fetchLeadData = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/leads/${leadId}`);
        if (!response.ok) throw new Error('Failed to fetch lead');
        const leadData = await response.json();
        setLead(leadData);
        hydrateFlowFromLead(leadData);
        // Resume on whichever stage this lead was last left on, rather than
        // always reopening at Prospect, so counselor/Branch Manager/CEO all
        // see the same current stage. An explicit initialStage prop (deep
        // link) takes priority over the persisted one.
        let targetStageId = resolvedInitialStage;
        if (!initialStage && leadData.opportunity_stage && FLOW_STAGE_IDS.includes(leadData.opportunity_stage)) {
          targetStageId = leadData.opportunity_stage;
          applyStageProgress(leadData.opportunity_stage);
        }
        if (leadData.opportunity_id && !initialOpportunityId) {
          setCompletedOpportunityId(Number(leadData.opportunity_id));
        }

        let latestOpportunity: any = null;
        const opportunitiesResponse = await fetch(`/api/opportunities?leadId=${leadId}`);
        if (opportunitiesResponse.ok) {
          const opportunities = await opportunitiesResponse.json();
          // A lead can have several opportunities (the conversion flow's own one, plus ones that
          // Add Service / contract-flow creates directly as 'won'). The wizard is the conversion
          // flow, so it must work on the lead's own flow opportunity (lead.opportunity_id) and only
          // fall back to the newest one. Taking opportunities[0] unconditionally made payments,
          // agreement and documents follow the newest direct contract while compliance followed
          // lead.opportunity_id - the signed agreement went to a different opportunity than the one
          // whose documents and payments had been verified.
          latestOpportunity = Array.isArray(opportunities)
            ? (opportunities.find((o: any) => Number(o.id) === Number((leadData as any)?.opportunity_id)) || opportunities[0] || null)
            : null;
          if (latestOpportunity?.id && !initialOpportunityId) {
            setCompletedOpportunityId(Number(latestOpportunity.id));
            // The opportunity's own saved product/amount/details are authoritative
            // once it exists — hydrateFlowFromLead (above) only fills blanks from
            // the lead's *current* fields, which can drift from what was actually
            // saved on the opportunity (e.g. the lead's service_interest or payTotal
            // changed after conversion). Force these fields to match the saved
            // opportunity record so reopening the draft doesn't show stale/wrong
            // product details.
            setProspectData(prev => ({
              ...prev,
              opportunityName: latestOpportunity.opportunityName || prev.opportunityName,
              estimatedValue: latestOpportunity.estimatedValue !== undefined && latestOpportunity.estimatedValue !== null
                ? String(latestOpportunity.estimatedValue)
                : prev.estimatedValue,
              priority: normalizePriorityForWizard(latestOpportunity.priority || prev.priority),
              description: latestOpportunity.description || prev.description,
              serviceRequired: latestOpportunity.serviceRequired || latestOpportunity.serviceType || prev.serviceRequired,
            }));
          }
        }

        const discountResponse = await fetch(`/api/discount-approvals?leadId=${leadId}`);
        if (discountResponse.ok) {
          const discountData = await discountResponse.json();
          const latestDiscount = discountData.data?.[0];
          if (latestDiscount) {
            setRetentionData(prev => ({
              ...prev,
              discountApprovalId: latestDiscount.id,
              discountStatus: latestDiscount.status || 'pending',
            }));
            // Restore the approved/pending discount amount into the quotation so
            // reopening this stage doesn't silently reset it to 0 while the
            // status pill still reads "approved" (the amount otherwise only
            // ever lived in local quotationData state, lost on remount).
            const approvedAmount = Number(latestDiscount.discountAmount);
            if ((latestDiscount.status === 'approved' || latestDiscount.status === 'pending') && Number.isFinite(approvedAmount) && approvedAmount > 0) {
              setQuotationData(prev => {
                const discount = Math.min(approvedAmount, prev.subtotal);
                const inferredTaxRate = prev.subtotal > 0 ? Number(prev.tax || 0) / prev.subtotal : 0;
                const taxableAmount = Math.max(0, prev.subtotal - discount);
                const tax = taxableAmount * inferredTaxRate;
                const total = taxableAmount + tax;
                return { ...prev, discount, tax, total };
              });
            }
          }
        }

        const complianceOpportunityId = initialOpportunityId || Number(latestOpportunity?.id) || Number((leadData as any)?.opportunity_id);
        const complianceResponse = await fetch(getComplianceApprovalsUrl(complianceOpportunityId));
        if (complianceResponse.ok) {
          const complianceData = await complianceResponse.json();
          const latestCompliance = complianceData.data?.[0];
          if (latestCompliance) {
            const status = latestCompliance.status || 'pending';
            setRetentionData(prev => ({
              ...prev,
              complianceApprovalId: latestCompliance.id,
              agreementComplianceStatus: status,
              retentionStatus: status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending',
              complianceManager: latestCompliance.reviewedBy || prev.complianceManager,
              reviewNotes: latestCompliance.reviewNotes || prev.reviewNotes,
              reviewDate: latestCompliance.reviewedAt ? latestCompliance.reviewedAt.split('T')[0] : prev.reviewDate,
            }));
            applyComplianceStatusToStages(status);

            // The Signed Agreement stage's own fields (signature, signature
            // date, uploaded document) are submitted straight into this same
            // compliance-approval record and never read back from anywhere
            // else - without this, reopening the wizard always showed a blank
            // upload box and empty signature fields even after a genuinely
            // successful submission.
            setSignedAgreementData(prev => ({
              ...prev,
              clientSignature: prev.clientSignature || latestCompliance.clientSignature || '',
              signatureDate: prev.signatureDate || (latestCompliance.signatureDate ? String(latestCompliance.signatureDate).split('T')[0] : ''),
              documentUrl: prev.documentUrl || latestCompliance.signedAgreementUrl || '',
              uploadedTocrm: prev.uploadedTocrm || Boolean(latestCompliance.signedAgreementUrl),
            }));
          }
        }

        if (complianceOpportunityId) {
          const workflowResponse = await fetch(`/api/crm-workflow/${complianceOpportunityId}`);
          if (workflowResponse.ok) {
            const workflowJson = await workflowResponse.json();
            const financeStatus = workflowJson.data?.finance_status || null;
            const complianceStatus = workflowJson.data?.compliance_status || null;
            setFinanceReviewStatus({ financeStatus, complianceStatus });
            // A deep link (e.g. the Clients tab's "Edit opportunity flow" button,
            // or a bookmarked/typed ?stage=closed URL) or the lead's own stale
            // persisted opportunity_stage can point past Accounts even though
            // Accounts/Compliance actually rejected this opportunity - opportunity_status
            // only ever reflects full payment at conversion time, not this review.
            // Pull the wizard back to the Accounts stage (where the real
            // verified/rejected status is already shown) instead of silently
            // rendering the Closed/Won screen.
            if ((financeStatus === 'rejected' || complianceStatus === 'rejected')) {
              const accountsIdx = FLOW_STAGE_IDS.indexOf('accounts');
              const currentTargetIdx = FLOW_STAGE_IDS.indexOf(targetStageId);
              if (currentTargetIdx > accountsIdx) {
                applyStageProgress('accounts');
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching lead:', error);
      } finally {
        setLoading(false);
      }
    };

    if (leadId) fetchLeadData();
  }, [leadId]);

  // ── Payment type for package selection ──
  const [paymentType, setPaymentType] = useState<'upfront' | 'monthly' | 'stage' | 'premium'>('stage');

  // ── Helper: compute package totals from a fee record ──
  const getFeePackageTotals = (fee: FeeRecord) => {
    const upfrontTotal  = Number(fee.upfront);
    const monthlyTotal  = Number(fee.firstMonth) + Number(fee.secondMonth) + Number(fee.thirdMonth);
    const stageTotal    = Number(fee.firstStage) + Number(fee.secondStage) + Number(fee.thirdStage) + Number(fee.forthStage) + Number(fee.fifthStage);
    // Premium package: two 50/50 installments (crm_fee.premium_fee_1 + premium_fee_2).
    const premiumTotal  = Number(fee.premium_fee_1 || 0) + Number(fee.premium_fee_2 || 0);
    return { upfrontTotal, monthlyTotal, stageTotal, premiumTotal };
  };

  // ── Auto-fetch fee: service + country from lead (branch as enhancement; falls back without it) ──
  useEffect(() => {
    // Prefer explicit serviceId from Prospect stage; fall back to lead's service_interest
    const leadAny = lead as any;
    const serviceId = prospectData.serviceId || String(leadAny?.service_interest || '');
    const countryId = Number(leadAny?.country_interest || 0);
    const branchId  = Number(leadAny?.branch || leadAny?.dmBranch?.id || 0);

    if (!serviceId) {
      setFeeData(null);
      return;
    }

    let cancelled = false;
    const fetchFee = async () => {
      setFeeLoading(true);
      try {
        // First try: service + country + branch (most specific)
        if (branchId && countryId) {
          const params = new URLSearchParams({ service: String(serviceId), country: String(countryId), branch: String(branchId) });
          const res  = await fetch(`/api/admin/fees/lookup?${params}`);
          const json = await res.json();
          if (!cancelled && json.data) { setFeeData(json.data); return; }
        }
        // Next: service + branch (catches branch-priced services with no country match, e.g. common-price services)
        if (branchId) {
          const params = new URLSearchParams({ service: String(serviceId), branch: String(branchId) });
          const res  = await fetch(`/api/admin/fees/lookup?${params}`);
          const json = await res.json();
          if (!cancelled && json.data) { setFeeData(json.data); return; }
        }
        // Fallback: service + country only (as set when creating the lead)
        if (countryId) {
          const params = new URLSearchParams({ service: String(serviceId), country: String(countryId) });
          const res  = await fetch(`/api/admin/fees/lookup?${params}`);
          const json = await res.json();
          if (!cancelled && json.data) { setFeeData(json.data); return; }
        }
        // Last resort: service only
        const params = new URLSearchParams({ service: String(serviceId) });
        const res  = await fetch(`/api/admin/fees/lookup?${params}`);
        const json = await res.json();
        if (!cancelled) setFeeData(json.data || null);
      } catch (err) {
        console.error('Fee lookup error:', err);
        if (!cancelled) setFeeData(null);
      } finally {
        if (!cancelled) setFeeLoading(false);
      }
    };

    fetchFee();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospectData.serviceId, (lead as any)?.service_interest, (lead as any)?.country_interest, (lead as any)?.branch]);

  // ── Pick up an agreement already generated elsewhere in this flow ──
  // The Payment stage's first save silently creates the opportunity (and a
  // "generated" agreement with a real number) via /api/lead-to-opportunity,
  // but this wizard's local agreementData state has no idea that happened —
  // without this, the Agreement stage would show blank defaults even though
  // a real agreement already exists, and the user couldn't see/download it
  // until they clicked Save again. Fetch it as soon as the opportunity id is
  // known, but don't clobber an agreement already loaded/edited locally.
  useEffect(() => {
    if (!completedOpportunityId || agreementData.agreementId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/opportunity-agreements?opportunityId=${completedOpportunityId}`);
        if (!res.ok) return;
        const agreements = await res.json();
        const existing = Array.isArray(agreements) ? agreements[0] : agreements?.data?.[0];
        if (!existing || cancelled) return;
        setAgreementData((prev) => ({
          ...prev,
          agreementId: existing.id ?? prev.agreementId,
          agreementNumber: existing.agreementNumber ?? prev.agreementNumber,
          agreementType: existing.agreementType ?? prev.agreementType,
          agreementTitle: existing.title ?? existing.agreementTitle ?? prev.agreementTitle,
          terms: existing.termsAndConditions ?? existing.terms ?? prev.terms,
          startDate: existing.startDate ? String(existing.startDate).split('T')[0] : prev.startDate,
          endDate: existing.endDate ? String(existing.endDate).split('T')[0] : prev.endDate,
          amount: existing.totalAmount ? String(existing.totalAmount) : prev.amount,
          companyName: existing.companyName ?? prev.companyName,
          companyAddress: existing.companyAddress ?? prev.companyAddress,
          status: existing.status ?? prev.status,
        }));
      } catch (err) {
        console.error('Error fetching existing agreement:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [completedOpportunityId, agreementData.agreementId]);

  // ── Pick up mandatory documents already uploaded in an earlier session ──
  // idProof/passportCopy only ever live as in-memory File objects, which are
  // gone after any remount (navigating away and back, or a page reload) -
  // without this, allMandatoryDocsUploaded silently resets to false and the
  // Documents stage blocks "Save & Continue", pushing the user to re-upload
  // documents that are already saved server-side. Also keeps the actual file
  // URL (uploadedDocUrls) so the Documents stage can link back to what's
  // already on file instead of showing a blank re-upload box with no sign
  // anything was ever uploaded.
  useEffect(() => {
    if (!completedOpportunityId || documentData.allMandatoryDocsUploaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/opportunity-documents?opportunityId=${completedOpportunityId}&status=uploaded`);
        if (!res.ok) return;
        const documents = await res.json();
        const list: any[] = Array.isArray(documents) ? documents : documents?.data || [];
        const categories = new Set(list.map((doc) => doc.category || doc.documentType));
        const hasAllMandatory = ['id_proof', 'passport', 'counsellor_sheet'].every((category) => categories.has(category));
        const uploadedDocUrls: Record<string, string> = {};
        list.forEach((doc) => {
          const category = doc.category || doc.documentType;
          if (category && doc.filePath) uploadedDocUrls[category] = doc.filePath;
        });
        if (!cancelled && Object.keys(uploadedDocUrls).length > 0) {
          setDocumentData((prev) => ({ ...prev, uploadedDocUrls: { ...prev.uploadedDocUrls, ...uploadedDocUrls } }));
        }
        if (hasAllMandatory && !cancelled) {
          setDocumentData((prev) => ({ ...prev, allMandatoryDocsUploaded: true }));
        }
      } catch (err) {
        console.error('Error fetching existing documents:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [completedOpportunityId, documentData.allMandatoryDocsUploaded]);

  const hydrateFlowFromLead = (leadData: Lead & Record<string, any>) => {
    const clientName = `${leadData.fname || ''} ${leadData.lname || ''}`.trim() || `Lead #${leadData.id}`;
    const service = String((leadData as Record<string, unknown>).service_interest_label || leadData.service_interest || '');
    const totalAmount = Number(leadData.payTotal || leadData.demandAmt || 0);
    const paidAmount = Number(leadData.paidYet || 0);
    const remainingBalance = Number(leadData.payBalance || Math.max(totalAmount - paidAmount, 0));
    const opportunityName = `${clientName}${service ? ` - ${service}` : ''}`;
    const today = localToday();
    const validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // Program validity comes from the lead's crm_service.validity (joined in
    // GET /api/leads/[id]) and drives both the agreement's duration and its
    // end date.
    const programValidityMonths = parseInt(String(leadData.program_validity || ''), 10) || 12;
    const endDate = computeAgreementEndDate(today, leadData.program_validity);
    const branchDetails = getLeadBranchDetails(leadData);

    // The lead's own opportunity_draft_data JSON snapshot (see
    // src/app/api/admin/opportunities/save/route.ts's mergeDraftData) is what
    // the counselor actually typed at these stages before any real
    // crm_opportunities row existed - preferred over the generic
    // name/amount/service-derived reconstruction below, which is only a
    // placeholder guess for a lead that was never actually taken this far.
    const rawDraft = (leadData as Record<string, unknown>).opportunity_draft_data;
    let draft: { prospect?: Record<string, unknown>; quotation?: Record<string, unknown> } = {};
    if (rawDraft) {
      try {
        draft = typeof rawDraft === 'string' ? JSON.parse(rawDraft) : (rawDraft as typeof draft);
      } catch {
        draft = {};
      }
    }
    const draftProspect = draft.prospect || {};
    const draftQuotation = draft.quotation || {};

    setProspectData(prev => ({
      ...prev,
      opportunityName: prev.opportunityName || String(draftProspect.opportunityName || '') || opportunityName,
      opportunityType: prev.opportunityType || String(draftProspect.opportunityType || '') || prev.opportunityType,
      estimatedValue: prev.estimatedValue || String(draftProspect.estimatedValue || '') || String(totalAmount || ''),
      priority: normalizePriorityForWizard(prev.priority || String(draftProspect.priority || '') || leadData.priority),
      description: prev.description || String(draftProspect.description || '') || leadData.lead_remark || `Opportunity for ${clientName}`,
      serviceRequired: prev.serviceRequired || String(draftProspect.serviceRequired || '') || service,
      serviceId: prev.serviceId || String(draftProspect.serviceId || '') || String((leadData as Record<string, unknown>).service_interest || ''),
    }));

    setQuotationData(prev => {
      const hasExistingItem = prev.items.some(item => item.description || Number(item.unitPrice) > 0);
      const draftItems = Array.isArray(draftQuotation.items) ? draftQuotation.items as QuotationData['items'] : null;
      return {
        ...prev,
        validUntil: prev.validUntil || String(draftQuotation.validUntil || '') || validUntil,
        items: hasExistingItem ? prev.items : (draftItems && draftItems.length > 0 ? draftItems : [{
          description: service || 'Consulting Service',
          quantity: 1,
          unitPrice: String(totalAmount || ''),
          total: String(totalAmount || ''),
        }]),
        subtotal: prev.subtotal || Number(draftQuotation.subtotal || 0) || totalAmount,
        discount: prev.discount || Number(draftQuotation.discount || 0),
        tax: prev.tax || Number(draftQuotation.tax || 0),
        total: prev.total || Number(draftQuotation.total || 0) || totalAmount,
        terms: prev.terms || String(draftQuotation.terms || '') || 'Payment as per agreed service package.',
      };
    });

    setPaymentData(prev => ({
      ...prev,
      totalAmount: prev.totalAmount || totalAmount,
      paidAmount: prev.paidAmount || paidAmount,
      remainingBalance: prev.remainingBalance || remainingBalance,
      paymentDate: prev.paymentDate || today,
    }));

    setAgreementData(prev => ({
      ...prev,
      agreementTitle: prev.agreementTitle || `Service Agreement - ${clientName}`,
      amount: prev.amount || String(totalAmount || ''),
      duration: prev.duration || String(programValidityMonths),
      startDate: prev.startDate || today,
      endDate: prev.endDate || endDate,
      companyName: prev.companyName || branchDetails.companyName,
      companyAddress: prev.companyAddress || branchDetails.branchAddress || '',
      terms: prev.terms || 'Standard service agreement terms apply.',
    }));

    setDocumentData(prev => ({
      ...prev,
      passportNumber: prev.passportNumber || leadData.id_number || '',
      clientActualName: prev.clientActualName || (leadData as any).client_actual_name || '',
    }));
  };

  const moveToNextStage = async () => {
    if (isReadOnly) {
      window.toast.info('This won client opportunity flow is view-only for your role.');
      return;
    }

    const validationError = validateStage(activeStage, {
      prospectData,
      quotationData,
      paymentData,
      documentData,
      agreementData,
      signedAgreementData,
    });
    if (validationError) {
      window.toast.error(validationError);
      return;
    }

    if ((activeStage === 'quotation' || activeStage === 'payment') && quotationData.discount > 0 && retentionData.discountStatus !== 'approved') {
      window.toast.error('Discount approval is required before continuing. Discounts over 20% must be approved in Discount Management by a Branch Manager or CEO.');
      return;
    }

    if (activeStage !== 'prospect' && activeStage !== 'quotation' && activeStage !== 'payment' && isFinanceOrComplianceRejected) {
      window.toast.error(
        financeReviewStatus?.financeStatus === 'rejected'
          ? 'Accounts rejected this opportunity\'s payment/discount verification. It cannot proceed until Accounts re-verifies it.'
          : 'Compliance rejected this opportunity. It cannot proceed until Compliance re-approves it.'
      );
      return;
    }

    if (activeStage === 'signed-agreement') {
      if (!signedAgreementData.documentUrl || !signedAgreementData.uploadedTocrm) {
        window.toast.warning('Upload the signed agreement before submitting it for compliance approval.');
        return;
      }

      // Block compliance submission until accounts team has verified a payment via Finance > Payment Verification
      try {
        const pvRes = await fetch(`/api/admin/payment-verification?leadId=${leadId}`);
        if (pvRes.ok) {
          const pvData = await pvRes.json();
          const paymentsArr: Array<{ accountantStatus?: string }> = pvData.data ?? pvData.payments ?? [];
          const hasVerified = paymentsArr.some((p) => p.accountantStatus === 'verified');
          if (!hasVerified) {
            window.toast.warning('Payment must be verified by the accounts team before submitting for compliance approval.\n\nGo to Finance → Payment Verification to verify this client\'s payment.');
            return;
          }
        }
      } catch {
        // Non-blocking: if the check fails, allow to proceed
      }

      await submitComplianceApproval();
    }

    if (activeStage === 'retained' && retentionData.agreementComplianceStatus !== 'approved') {
      window.toast.error('Compliance officer approval is required before closing or marking the opportunity as won.');
      return;
    }

    const currentIndex = stages.findIndex(s => s.id === activeStage);
    if (currentIndex < stages.length - 1) {
      // Save current stage data - do not advance past a stage whose data
      // failed to persist (saveStageData already surfaced a toast).
      const saved = await saveStageData(activeStage);
      if (!saved) return;

      // Mark current as completed
      const newStages = [...stages];
      newStages[currentIndex].status = 'completed';
      newStages[currentIndex + 1].status = 'current';
      setStages(newStages);
      const nextStageId = newStages[currentIndex + 1].id;
      setActiveStage(nextStageId);
      persistCurrentStage(nextStageId);
    }
  };

  // Records how far this lead has progressed through the flow so anyone who
  // reopens it (counselor, Branch Manager, CEO) resumes on the same stage
  // instead of restarting at Prospect. Fire-and-forget: a failed write here
  // shouldn't block the counselor from continuing the flow itself.
  const persistCurrentStage = async (stageId: string) => {
    try {
      await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity_stage: stageId }),
      });
    } catch (error) {
      console.error('Error persisting opportunity stage:', error);
    }
  };

  // Returns whether the save actually succeeded - callers (moveToNextStage in
  // particular) must not advance the wizard past a stage whose data failed to
  // persist, or the counselor loses that stage's data with no indication
  // anything went wrong beyond a toast that's easy to miss.
  const saveStageData = async (stageId: string): Promise<boolean> => {
    if (isReadOnly) {
      window.toast.info('This won client opportunity flow is view-only for your role.');
      return false;
    }

    try {
      const stageDataMap: Record<string, any> = {
        prospect: prospectData,
        quotation: quotationData,
        payment: paymentData,
        accounts: {},
        documents: documentData,
        agreement: agreementData,
        'signed-agreement': signedAgreementData,
        retained: retentionData,
      };

      const dataToSave = {
        leadId,
        stage: stageId,
        data: stageDataMap[stageId],
        timestamp: new Date().toISOString()
      };

      console.log('Saving stage data:', dataToSave);
      const response = await fetch('/api/admin/opportunities/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSave)
      });

      if (!response.ok) {
        throw new Error('Failed to save stage data');
      }

      const result = await response.json();
      console.log('Stage data saved successfully:', result);
      return true;
    } catch (error) {
      console.error('Error saving stage data:', error);
      window.toast.error('Failed to save data. Please try again.');
      return false;
    }
  };

  const moveToPreviousStage = () => {
    if (isReadOnly) {
      return;
    }

    const currentIndex = stages.findIndex(s => s.id === activeStage);
    if (currentIndex > 0) {
      const newStages = [...stages];
      newStages[currentIndex].status = 'pending';
      newStages[currentIndex - 1].status = 'current';
      setStages(newStages);
      setActiveStage(newStages[currentIndex - 1].id);
    }
  };

  const handleStageClick = (stageId: string) => {
    // Stages must be completed one at a time via each stage's own Next/Continue
    // button — a stage that's still 'pending' hasn't been reached yet, so
    // clicking its tab directly (e.g. skipping straight to Documents) is a no-op.
    const targetStage = stages.find(stage => stage.id === stageId);
    const isApprovedRetentionReviewTab = stageId === 'retention-rejected' && retentionData.agreementComplianceStatus === 'approved';
    if (!targetStage || (targetStage.status === 'pending' && !isApprovedRetentionReviewTab)) return;

    const quotationIndex = stages.findIndex(stage => stage.id === 'quotation');
    const targetIndex = stages.findIndex(stage => stage.id === stageId);
    if (quotationData.discount > 0 && retentionData.discountStatus !== 'approved' && targetIndex > quotationIndex) {
      window.toast.error('Discount approval is required before moving past quotation. Please request approval and wait for CEO approval in Discount Management.');
      setActiveStage('quotation');
      return;
    }

    setActiveStage(stageId);
  };

  // Returns the freshly-fetched status so callers that need to gate an
  // immediate action (e.g. creating a receipt) can check the real, current
  // value instead of racing the setRetentionData state update below - the
  // wizard otherwise only ever fetched this once on initial page load,
  // which goes stale the moment a discount is approved (BM/CEO action, or
  // the auto-approve tier's own debounce) while the tab is already open.
  const refreshDiscountApproval = async (): Promise<'not_required' | 'pending' | 'approved' | 'rejected'> => {
    try {
      const discountResponse = await fetch(`/api/discount-approvals?leadId=${leadId}`, { cache: 'no-store' });
      if (!discountResponse.ok) return retentionData.discountStatus;
      const discountData = await discountResponse.json();
      const latestDiscount = discountData.data?.[0];
      if (!latestDiscount) return retentionData.discountStatus;
      const resolvedStatus = (latestDiscount.status || 'pending') as 'not_required' | 'pending' | 'approved' | 'rejected';
      setRetentionData(prev => ({
        ...prev,
        discountApprovalId: latestDiscount.id,
        discountStatus: resolvedStatus,
      }));
      return resolvedStatus;
    } catch (error) {
      console.error('Error refreshing discount approval status:', error);
      return retentionData.discountStatus;
    }
  };

  // Re-check discount status right when the counselor actually reaches the
  // stages the approval gates (Quotation, Payment) rather than only once at
  // initial page load - closes the staleness window without needing the
  // user to know to click a manual refresh button.
  useEffect(() => {
    if ((activeStage === 'quotation' || activeStage === 'payment') && quotationData.discount > 0 && retentionData.discountStatus !== 'approved') {
      refreshDiscountApproval();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage]);

  const handleDiscountChanged = (discount: number) => {
    if (discount <= 0) {
      setRetentionData(prev => ({ ...prev, discountStatus: 'not_required' }));
      return;
    }

    setRetentionData(prev => {
      if (prev.discountStatus === 'pending' || prev.discountStatus === 'approved') {
        // discountApprovalId is deliberately KEPT (not nulled) here - the next
        // handleRequestDiscount call passes it as supersedesId so the old,
        // now-wrong entry gets soft-deleted instead of left dangling as a
        // stale 'approved'/'pending' row forever once a fresh one is submitted.
        return { ...prev, discountStatus: 'not_required' };
      }
      return prev;
    });
  };

  // isReapply: correcting a wrong amount or a wrongly-approved/rejected
  // discount, rather than the first request. Passes the current
  // discountApprovalId as supersedesId, which the server soft-deletes
  // immediately (before creating the replacement) - see POST
  // /api/discount-approvals - so the old, wrong entry never reads as active
  // again anywhere (this wizard, Discount Management, etc).
  const handleRequestDiscount = async (isReapply = false) => {
    if (requestingDiscount) return;
    setRequestingDiscount(true);
    try {
      const originalAmount = quotationData.subtotal || parseFloat(prospectData.estimatedValue);
      if (!originalAmount || originalAmount <= 0 || quotationData.discount <= 0) {
        window.toast.warning('Please enter quotation line items and a valid discount amount before requesting approval');
        return;
      }

      const discountData = {
        leadId: leadId,
        opportunityId: completedOpportunityId || (lead as any)?.opportunity_id || null,
        discountType: 'fixed',
        discountAmount: quotationData.discount,
        originalAmount,
        discountedAmount: originalAmount - quotationData.discount,
        currency: currencyCode,
        reason: isReapply
          ? `Corrected discount for ${prospectData.opportunityName} (replaces a wrong amount/approval)`
          : `Discount requested for ${prospectData.opportunityName}`,
        requestedBy: user?.id || 1,
        status: 'pending',
        // Superseding whatever old approval-id is still tracked applies
        // whether this is the explicit "Request a correction" flow or a
        // Branch Manager/CEO simply editing an already-approved amount and
        // resubmitting - either way, an old id still present here means the
        // one it belonged to needs to be replaced, not left dangling.
        ...(retentionData.discountApprovalId ? { supersedesId: retentionData.discountApprovalId } : {}),
      };

      const response = await fetch('/api/discount-approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discountData)
      });

      if (response.ok) {
        const discount = await response.json();
        // 0-20% discounts are auto-approved server-side (see /api/discount-approvals
        // POST) — the server tells us which via data.status, so the flow isn't
        // blocked waiting on an approval that was never actually required.
        const resolvedStatus: 'pending' | 'approved' = discount.data?.status === 'approved' ? 'approved' : 'pending';
        setRetentionData(prev => ({
          ...prev,
          discountApprovalId: discount.data?.id || discount.id,
          discountStatus: resolvedStatus
        }));
        window.toast.success(
          resolvedStatus === 'approved'
            ? 'Discount applied — 0-20% discounts are auto-approved, no sign-off needed.'
            : isReapply
              ? 'Correction submitted. The previous request was replaced and this one now needs Branch Manager or CEO approval.'
              : 'Discount request submitted. Branch Manager or CEO must approve it in Discount Management before you can continue past the payment stage.'
        );
      } else {
        const errorBody = await response.json().catch(() => null);
        window.toast.error(errorBody?.error || 'Failed to submit discount request');
      }
    } catch (error) {
      console.error('Error requesting discount:', error);
      window.toast.error('Error requesting discount');
    } finally {
      setRequestingDiscount(false);
    }
  };

  const handleProcessReassignment = async () => {
    try {
      const reassignmentData = {
        leadId: leadId,
        fromEmployeeId: lead?.assignTo || 1,
        toEmployeeId: 1, // Would be selected from dropdown
        reassignmentType: 'manual',
        reason: retentionData.notes || 'Lead reassignment during retention process',
        previousStatus: lead?.status || 'new',
        newStatus: 'reassigned',
        reassignmentDate: new Date()
      };

      const response = await fetch('/api/lead-reassignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reassignmentData)
      });

      if (response.ok) {
        const reassignment = await response.json();
        setRetentionData(prev => ({ ...prev, reassignmentId: reassignment.id }));
        window.toast.success('Lead reassignment submitted successfully!');
      } else {
        window.toast.error('Failed to submit lead reassignment');
      }
    } catch (error) {
      console.error('Error processing reassignment:', error);
      window.toast.error('Error processing reassignment');
    }
  };

  const submitComplianceApproval = async () => {
    if (retentionData.agreementComplianceStatus === 'approved' || retentionData.agreementComplianceStatus === 'pending') return;

    const response = await fetch('/api/opportunity-compliance-approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId,
        opportunityId: completedOpportunityId || (lead as any)?.opportunity_id || null,
        signedAgreementUrl: signedAgreementData.documentUrl,
        clientSignature: signedAgreementData.clientSignature,
        signatureDate: signedAgreementData.signatureDate,
        // ensureOpportunityForClient() only records the handover note once, at
        // the Payment stage — before this Counselor Conversation Summary field
        // (entered later, on the Agreement stage) has any value. Send it again
        // here so compliance actually sees what the counselor wrote.
        conversationSummary: agreementData.counselorConversationSummary,
        submittedBy: user?.id || lead?.assignTo || 1,
        status: 'pending'
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to submit signed agreement for compliance review');
    }

    const result = await response.json();
    setRetentionData(prev => ({
      ...prev,
      complianceApprovalId: result.data?.id || prev.complianceApprovalId,
      agreementComplianceStatus: 'pending',
      retentionStatus: 'pending',
    }));
  };

  const handleRefreshComplianceStatus = async () => {
    try {
      const response = await fetch(getComplianceApprovalsUrl(initialOpportunityId || completedOpportunityId || Number((lead as any)?.opportunity_id)));
      if (!response.ok) {
        window.toast.error('Failed to refresh compliance status');
        return;
      }

      const complianceData = await response.json();
      const latestCompliance = complianceData.data?.[0];
      if (!latestCompliance) {
        window.toast.warning('No compliance review found yet.');
        return;
      }

      const status = latestCompliance.status || 'pending';
      setRetentionData(prev => ({
        ...prev,
        complianceApprovalId: latestCompliance.id,
        agreementComplianceStatus: status,
        retentionStatus: status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending',
        complianceManager: latestCompliance.reviewedBy || prev.complianceManager,
        reviewNotes: latestCompliance.reviewNotes || prev.reviewNotes,
        reviewDate: latestCompliance.reviewedAt ? latestCompliance.reviewedAt.split('T')[0] : prev.reviewDate,
      }));
      applyComplianceStatusToStages(status);

      if (status === 'approved') {
        window.toast.success('Compliance manager approved the agreement. You can now mark the opportunity as won.');
      } else if (status === 'rejected') {
        window.toast.error('Compliance manager rejected the agreement.');
      } else {
        window.toast.warning('Compliance review is still pending.');
      }
    } catch (error) {
      console.error('Error refreshing compliance status:', error);
      window.toast.error('Error refreshing compliance status');
    }
  };

  const ensureOpportunityForClient = async (paymentOverride: Partial<PaymentData> = {}) => {
    const effectivePaymentData = { ...paymentData, ...paymentOverride };
    const existingOpportunityId = completedOpportunityId || Number((lead as any)?.opportunity_id);
    if (existingOpportunityId) return existingOpportunityId;
    const branchDetails = getLeadBranchDetails(lead as any);

    const existingResponse = await fetch(`/api/opportunities?leadId=${leadId}`);
    if (existingResponse.ok) {
      const opportunities = await existingResponse.json();
      const latestOpportunity = Array.isArray(opportunities) ? opportunities[0] : null;
      if (latestOpportunity?.id) {
        setCompletedOpportunityId(Number(latestOpportunity.id));
        return Number(latestOpportunity.id);
      }
    }

    const createResponse = await fetch('/api/lead-to-opportunity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify((() => {
        const totalAmount = Number(quotationData.total || effectivePaymentData.totalAmount || 0);
        const paidAmount = Math.min(Math.max(0, Number(effectivePaymentData.paidAmount || 0)), totalAmount);
        const remainingBalance = Math.max(totalAmount - paidAmount, 0);

        return {
        leadId,
        // Client creation happens only after Accounts + Compliance approval
        // when the counselor closes/marks the opportunity won.
        createClient: false,
        opportunityData: {
          opportunityName: prospectData.opportunityName || `${lead?.fname || ''} ${lead?.lname || ''} - ${lead?.service_interest || prospectData.serviceRequired}`,
          description: prospectData.description || `Opportunity created for ${lead?.fname || ''} ${lead?.lname || ''}`,
          estimatedValue: parseFloat(prospectData.estimatedValue) || quotationData.total || (lead as any)?.payTotal || 0,
          priority: prospectData.priority || (lead as any)?.priority || 'Medium',
          documentsVerified: documentData.allMandatoryDocsUploaded,
          serviceRequired: prospectData.serviceRequired || (lead as any)?.service_interest || 'Consulting Service',
        },
        paymentData: {
          totalAmount,
          amount: paidAmount,
          paidAmount,
          paymentMethod: effectivePaymentData.paymentMethod || 'cash',
          paymentDate: effectivePaymentData.paymentDate,
          transactionId: effectivePaymentData.transactionId,
          // Without this, /api/lead-to-opportunity falls back to 0 (see its
          // `paymentData.taxAmount || invoiceData.taxAmt || 0`), so the
          // payment/invoice records permanently show no VAT/GST — most
          // visible on India's 18% GST, but wrong for every branch's tax.
          // The printed receipt itself recomputes this live from the branch's
          // vat_gst_percent (buildReceiptHtml) so it isn't affected, but every
          // other screen (Payments list, Invoices) reads this stored column.
          taxAmount: quotationData.tax || 0,
          discountAmount: quotationData.discount || 0,
          proofOfPaymentUrl: effectivePaymentData.proofOfPaymentUrl || null,
          paymentStructure: effectivePaymentData.paymentStructure,
          // Only a plan that matches this balance is sent; the Payment stage blocks saving otherwise.
          ...(effectivePaymentData.paymentStructure === 'installment' && !validatePlan(effectivePaymentData.installments, remainingBalance)
            ? { installments: effectivePaymentData.installments, dueDate: effectivePaymentData.installments![0].dueDate }
            : { dueDate: effectivePaymentData.dueDate || undefined }),
          remark: effectivePaymentData.remark || undefined,
          adminFeeIncluded: effectivePaymentData.adminFeeIncluded || false,
          includeVat: effectivePaymentData.includeVat !== false,
        },
        agreementData: {
          title: agreementData.agreementTitle || `Service Agreement - ${lead?.fname || ''} ${lead?.lname || ''}`,
          agreementType: agreementData.agreementType,
          duration: agreementData.duration,
          startDate: agreementData.startDate,
          endDate: agreementData.endDate,
          totalAmount: quotationData.total || parseFloat(prospectData.estimatedValue) || 0,
          terms: agreementData.terms,
          specialConditions: agreementData.specialConditions,
          companyName: agreementData.companyName || branchDetails.companyName,
          companyAddress: agreementData.companyAddress || branchDetails.branchAddress,
          status: signedAgreementData.uploadedTocrm ? 'uploaded' : 'generated',
          documentUrl: signedAgreementData.documentUrl,
          clientSignature: signedAgreementData.clientSignature,
          signatureDate: signedAgreementData.signatureDate
        },
        invoiceData: {
          purpose: prospectData.serviceRequired || lead?.service_interest || '',
          discount: quotationData.discount || 0,
          taxAmt: quotationData.tax || 0,
          amount: paidAmount,
          totPayAmt: totalAmount,
          payBalance: remainingBalance,
          payment_mode: effectivePaymentData.paymentMethod || 'cash'
        },
        counselorHandover: {
          summary: agreementData.counselorConversationSummary
        }
      };
      })())
    });

    if (!createResponse.ok) {
      const error = await createResponse.json().catch(() => ({}));
      const details = Array.isArray(error.errors) ? `: ${error.errors.join(', ')}` : error.details ? `: ${error.details}` : '';
      throw new Error(`${error.error || 'Failed to create opportunity for operations'}${details}`);
    }

    const result = await createResponse.json();
    const createdOpportunityId = Number(result.data?.opportunity?.id);
    if (!createdOpportunityId) {
      throw new Error('Opportunity conversion did not return an opportunity ID');
    }
    setCompletedOpportunityId(createdOpportunityId);
    return createdOpportunityId;
  };

  const saveAgreement = async () => {
    const opportunityId = await ensureOpportunityForClient();
    let agreementId = agreementData.agreementId;
    let existingAgreementNumber: string | null = null;

    if (!agreementId) {
      const response = await fetch(`/api/opportunity-agreements?opportunityId=${opportunityId}`);
      if (response.ok) {
        const agreements = await response.json();
        agreementId = Number(agreements?.[0]?.id || 0) || null;
        existingAgreementNumber = agreements?.[0]?.agreementNumber || null;
      }
    }

    // Reserve the number once so the value saved to the database and the value
    // shown on the downloaded PDF (downloadAgreementPdf, below) are always the
    // same agreement number instead of two independently-generated timestamps.
    const newAgreementNumber = `AGR-${Date.now()}`;
    const branchDetails = getLeadBranchDetails(lead as any);

    const payload = {
      agreementType: agreementData.agreementType,
      agreementTitle: agreementData.agreementTitle,
      title: agreementData.agreementTitle,
      duration: agreementData.duration,
      startDate: agreementData.startDate || localToday(),
      endDate: agreementData.endDate || computeAgreementEndDate(
        agreementData.startDate || localToday(),
        (lead as any)?.program_validity,
      ),
      amount: Number(agreementData.amount || quotationData.total || 0),
      totalAmount: Number(agreementData.amount || quotationData.total || 0),
      terms: agreementData.terms,
      termsAndConditions: agreementData.terms,
      specialConditions: agreementData.specialConditions,
      companyName: agreementData.companyName || branchDetails.companyName,
      companyAddress: agreementData.companyAddress || branchDetails.branchAddress,
    };

    const response = await fetch(
      agreementId ? `/api/opportunity-agreements?id=${agreementId}` : '/api/opportunity-agreements',
      {
        method: agreementId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agreementId ? payload : {
          ...payload,
          opportunityId,
          agreementNumber: newAgreementNumber,
          status: 'generated',
          createdBy: user?.id || lead?.assignTo || 1,
          uploadedBy: user?.id || lead?.assignTo || 1,
        }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to save agreement');

    const savedId = Number(result.data?.id || result.id || agreementId || 0);
    // On create, the server assigns the real AG/{branch}/{product}/{date}/{seq}
    // number from the new row's own id (it can't be predicted client-side
    // before that id exists) — always prefer whatever it echoes back.
    const savedAgreementNumber = agreementId
      ? (existingAgreementNumber || result.data?.agreementNumber || agreementData.agreementNumber || null)
      : (result.data?.agreementNumber || result.agreementNumber || newAgreementNumber);
    setAgreementData((current) => ({
      ...current,
      agreementId: savedId || current.agreementId,
      agreementNumber: savedAgreementNumber || current.agreementNumber,
      status: 'generated',
    }));
    return savedId;
  };

  const deleteAgreement = async () => {
    const agreementId = agreementData.agreementId;
    if (!agreementId) return;
    const response = await fetch(`/api/opportunity-agreements?id=${agreementId}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to delete agreement');
    setAgreementData((current) => ({ ...current, agreementId: null, status: 'draft' }));
  };

  const handleCompleteRetention = async () => {
    if (closingWon) return;
    setClosingWon(true);
    try {
      if (retentionData.agreementComplianceStatus !== 'approved') {
        window.toast.error('Compliance officer approval is required before this opportunity can be closed or won.');
        return;
      }

      if (isFinanceOrComplianceRejected) {
        window.toast.error(
          financeReviewStatus?.financeStatus === 'rejected'
            ? 'Accounts rejected this opportunity\'s payment/discount verification. It cannot be closed or marked won until Accounts re-verifies it.'
            : 'Compliance rejected this opportunity. It cannot be closed or marked won until Compliance re-approves it.'
        );
        return;
      }

      const opportunityId = await ensureOpportunityForClient();
      const branchDetails = getLeadBranchDetails(lead as any);

      let agreementResult: any = null;
      const existingAgreementResponse = await fetch(`/api/agreement-generation?opportunityId=${opportunityId}`);
      if (existingAgreementResponse.ok) {
        const existingAgreementData = await existingAgreementResponse.json();
        const latestAgreement = Array.isArray(existingAgreementData.data) ? existingAgreementData.data[0] : null;
        if (latestAgreement) {
          // The agreement/receipt must print the client's actual legal name
          // (Documents stage, mandatory) rather than fname/lname once set.
          const clientName = (lead as any)?.client_actual_name || `${lead?.fname || ''} ${lead?.lname || ''}`.trim() || 'Client';
          // A not-yet-signed agreement's stored HTML can predate a later fix to its
          // branch's legal text (branchAgreementProfiles.ts) — regenerate it fresh
          // before finalizing to "won" so the client doesn't get stale branch details.
          // An already-signed/uploaded agreement is a real executed document and must
          // never be silently rewritten.
          const isAlreadySigned = Boolean(latestAgreement.uploadedToCrm) || Boolean(latestAgreement.documentUrl);
          let content = latestAgreement.content;
          if (!isAlreadySigned) {
            const destinationCountry = (lead as any)?.country_interest_label || (lead as any)?.country_interest || 'Not specified';
            const serviceProgram = (lead as any)?.service_interest_label || (lead as any)?.service_interest || agreementData.agreementType || 'Consulting Service';
            const totalAmountForAgreement = quotationData?.total || agreementData.amount || (lead as any)?.payTotal || (lead as any)?.demandAmt || '0';
            // Initial Payment is the amount the client actually paid when the
            // receipt was generated (Payment stage), not the pre-discount
            // quotation subtotal - the subtotal can exceed the (post-discount)
            // Total Advisory Fee itself, which showed an initial payment bigger
            // than the total.
            const initialPaymentForAgreement = String(Math.min(Math.max(0, Number(paymentData.paidAmount || 0)), Number(totalAmountForAgreement) || 0));
            const secondPaymentForAgreement = String(Math.max(0, Number(totalAmountForAgreement) - Number(initialPaymentForAgreement)));

            const planRes = await fetch(`/api/opportunities/${opportunityId}/payment-schedule`, { cache: 'no-store' });
            // Never rewrite the stored agreement without its plan because of a failed lookup.
            if (!planRes.ok) throw new Error('Could not load the instalment plan for the agreement');
            const planRows = (await planRes.json()).installments;
            // The branch agreement templates are large, so they load only when needed.
            const { renderAgreementForBranch } = await import('@/lib/renderAgreementForBranch');
            content = renderAgreementForBranch(branchDetails.branchAbbrv, {
              installments: planRows,
              agreementNumber: latestAgreement.agreementNumber,
              agreementDate: new Date().toLocaleDateString('en-GB'),
              agreementExpiry: agreementData.endDate ? new Date(agreementData.endDate).toLocaleDateString('en-GB') : '',
              clientName,
              clientEmail: (lead as any)?.email || '',
              clientPhone: (lead as any)?.phone || (lead as any)?.mobile || '',
              clientAddress: (lead as any)?.address || '',
              nationality: (lead as any)?.nationality || '',
              passportNumber: (lead as any)?.id_number || '',
              idNumber: (lead as any)?.emirates_id || (lead as any)?.id_number || '',
              serviceProgram,
              programCode: agreementData.agreementType || '',
              programTermSchedule: (lead as any)?.program_validity
                || (agreementData.startDate && agreementData.endDate
                ? `${agreementData.startDate} to ${agreementData.endDate}`
                : ''),
              destinationCountry,
              totalAmount: String(totalAmountForAgreement),
              initialPayment: initialPaymentForAgreement,
              secondPayment: secondPaymentForAgreement,
              clientId: String((lead as any)?.id || ''),
              includedDeliverables: agreementData.agreementTitle || '',
              expressExclusions: '',
              specialTerms: agreementData.terms || '',
            });

            // Persist the refreshed content so the standalone agreement page and any
            // later lookup also see it, not just this in-memory value. Best-effort:
            // if this save fails, "Won" can still proceed with the stale content
            // (same as before this fix), rather than blocking retention on it.
            fetch(`/api/opportunity-agreements?id=${latestAgreement.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content }),
            }).catch((err) => console.error('Failed to persist refreshed agreement content:', err));
          }

          agreementResult = {
            data: {
              agreementId: latestAgreement.id,
              agreementNumber: latestAgreement.agreementNumber,
              content,
              opportunity: {
                clientName: latestAgreement.clientName || clientName,
                serviceType: prospectData.serviceRequired || lead?.service_interest || 'Service'
              }
            }
          };
        }
      }

      if (!agreementResult) {
        // Same "amount the client actually agreed to" computation used when
        // refreshing an existing agreement above — the fixed amount after
        // the approved discount (and tax), not the opportunity's original
        // pre-discount package/estimated value.
        const firstGenTotalAmount = quotationData?.total || agreementData.amount || (lead as any)?.payTotal || (lead as any)?.demandAmt || 0;
        // Same actual-amount-paid fix as the refresh branch above.
        const firstGenInitialPayment = String(Math.min(Math.max(0, Number(paymentData.paidAmount || 0)), Number(firstGenTotalAmount) || 0));
        const firstGenSecondPayment = String(Math.max(0, Number(firstGenTotalAmount) - Number(firstGenInitialPayment)));

        const agreementResponse = await fetch('/api/agreement-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opportunityId,
          agreementData: {
            agreementType: agreementData.agreementType || 'service_agreement',
            title: `Service Agreement - ${prospectData.opportunityName || `${lead?.fname} ${lead?.lname}`}`,
            description: `Service agreement for ${prospectData.serviceRequired || lead?.service_interest}`,
            terms: generateDefaultTerms(prospectData),
            startDate: agreementData.startDate || localToday(),
            endDate: agreementData.endDate || computeAgreementEndDate(
              agreementData.startDate || localToday(),
              (lead as any)?.program_validity,
            ),
            paymentMethod: 'Bank Transfer',
            paymentSchedule: 'As per agreed schedule',
            totalAmount: firstGenTotalAmount,
            initialPayment: firstGenInitialPayment,
            secondPayment: firstGenSecondPayment,
          },
          clientData: {
            companyName: agreementData.companyName || branchDetails.companyName,
            companyAddress: agreementData.companyAddress || branchDetails.branchAddress
          },
          templateId: null
        })
      });

        if (!agreementResponse.ok) {
          const agreementError = await agreementResponse.json();
          throw new Error(agreementError.error || 'Failed to generate agreement');
        }

        agreementResult = await agreementResponse.json();
      }

      // Update opportunity status to won
      const opportunityStatusResponse = await fetch(`/api/opportunities/${opportunityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'won',
          actualCloseDate: new Date(),
          actualValue: quotationData.total || parseFloat(prospectData.estimatedValue) || 0,
          retentionStatus: 'approved',
          retentionDate: new Date(),
          agreementGenerated: true,
          agreementId: agreementResult.data.agreementId,
          agreementSent: true,
          agreementSigned: true,
          paymentReceived: true,
          documentsVerified: true
        })
      });

      if (!opportunityStatusResponse.ok) {
        const opportunityStatusError = await opportunityStatusResponse.json().catch(() => ({}));
        throw new Error(opportunityStatusError.error || 'Failed to update opportunity status');
      }
      setCompletedOpportunityId(opportunityId);

      const leadStatusResponse = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'retained',
          convet: 'Client',
          opportunity_status: 'won',
          opportunity_stage: 'closed',
          opportunity_id: opportunityId,
          conversion_date: localToday(),
          conversion_reason: 'Successfully converted and retained client'
        })
      });

      if (!leadStatusResponse.ok) {
        const leadStatusError = await leadStatusResponse.json().catch(() => ({}));
        throw new Error(leadStatusError.error || 'Failed to update lead status after opportunity conversion');
      }

      // Update stages
      const updatedStages = stages.map(stage =>
        stage.id === 'retained' ? { ...stage, status: 'completed' as const } :
          stage.id === 'closed' ? { ...stage, status: 'current' as const } : stage
      );
      setStages(updatedStages);
      setActiveStage('closed');
      setLead((current: any) => current ? {
        ...current,
        status: 'retained',
        convet: 'Client',
        opportunity_status: 'won',
        opportunity_stage: 'closed',
        opportunity_id: opportunityId,
      } : current);

      window.toast.success(`🎉 Opportunity completed and retained successfully!\n\nAgreement generated: ${agreementResult.data.agreementNumber}\nClient: ${agreementResult.data.opportunity.clientName}\nService: ${agreementResult.data.opportunity.serviceType}`);

    } catch (error) {
      console.error('Error completing retention:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      window.toast.error('Error completing retention: ' + errorMessage);
    } finally {
      setClosingWon(false);
    }
  };

  const generateDefaultTerms = (prospectData: any) => {
    return `
1. SERVICE PROVISION
   The Service Provider agrees to provide ${prospectData.serviceRequired || 'professional'} services to the Client as specified in this agreement.

2. CLIENT OBLIGATIONS
   The Client agrees to:
   - Provide all necessary information and documentation required for the services
   - Make timely payments as agreed
   - Cooperate with the Service Provider throughout the process
   - Maintain confidentiality of all information shared

3. SERVICE PROVIDER OBLIGATIONS
   The Service Provider agrees to:
   - Provide professional and timely services
   - Maintain confidentiality of client information
   - Keep the client informed of progress
   - Deliver services as per agreed standards

4. PAYMENT TERMS
   - Total Amount: ${prospectData.estimatedValue || 'To be determined'}
   - Payment Method: Bank Transfer
   - Payment Schedule: As per agreed schedule
   - Late payments may incur additional charges

5. TERM AND TERMINATION
   - This agreement is valid for the duration specified
   - Either party may terminate with 30 days written notice
   - Termination does not affect obligations accrued prior to termination

6. CONFIDENTIALITY
   - Both parties agree to maintain confidentiality of all information
   - Information shared during the service provision is protected
   - This obligation survives the termination of this agreement

7. GOVERNING LAW
   - This agreement shall be governed by the laws of United Arab Emirates
   - Any disputes shall be resolved through mutual discussion or legal means

8. ENTIRE AGREEMENT
   - This document constitutes the entire agreement between the parties
   - No modifications or amendments shall be valid unless in writing and signed by both parties
   - Both parties acknowledge having read, understood, and agreed to the terms contained herein
  `.trim();
  };

  // Fetch the following stage in the background so Continue doesn't wait for it.
  useEffect(() => {
    const order = ['prospect', 'quotation', 'payment', 'accounts', 'documents', 'agreement', 'signed-agreement', 'retained', 'closed'];
    const names = ['ProspectStage', 'QuotationStage', 'PaymentStage', 'AccountsStage', 'DocumentsStage', 'AgreementStage', 'SignedAgreementStage', 'RetainedStage', 'ClosedStage'] as const;
    const next = names[order.indexOf(activeStage) + 1];
    if (!next) return;
    const timer = setTimeout(() => { stageLoaders[next]().catch(() => { /* retried when the stage is opened */ }); }, 800);
    return () => clearTimeout(timer);
  }, [activeStage]);

  const renderStageContent = () => {
    switch (activeStage) {
      case 'prospect':
        return <ProspectStage
          lead={lead}
          data={prospectData}
          setData={setProspectData}
          onLeadUpdated={setLead}
          onSaveProspect={() => saveStageData('prospect')}
          onNext={moveToNextStage}
          feeData={feeData}
          feeLoading={feeLoading}
          paymentType={paymentType}
          setPaymentType={setPaymentType}
          getFeePackageTotals={getFeePackageTotals}
        />;
      case 'quotation':
        return <QuotationStage
          lead={lead}
          data={quotationData}
          setData={setQuotationData}
          feeData={feeData}
          feeLoading={feeLoading}
          retentionData={retentionData}
          requestingDiscount={requestingDiscount}
          onRequestDiscount={handleRequestDiscount}
          onRefreshDiscount={refreshDiscountApproval}
          onDiscountChanged={handleDiscountChanged}
          onNext={moveToNextStage}
          onPrevious={moveToPreviousStage}
          paymentType={paymentType}
          setPaymentType={setPaymentType}
        />;
      case 'payment':
        return <PaymentStage
          lead={lead}
          data={paymentData}
          setData={setPaymentData}
          quotationTotal={quotationData.total}
          quotationTax={quotationData.tax}
          quotationDiscount={quotationData.discount}
          opportunityId={completedOpportunityId}
          onEnsureOpportunity={ensureOpportunityForClient}
          discountPending={quotationData.discount > 0 && retentionData.discountStatus !== 'approved'}
          discountStatus={retentionData.discountStatus}
          onRefreshDiscount={refreshDiscountApproval}
          onNext={moveToNextStage}
          onPrevious={moveToPreviousStage}
        />;
      case 'accounts':
        return <AccountsStage
          lead={lead}
          leadId={leadId}
          opportunityId={completedOpportunityId}
          onNext={moveToNextStage}
          onPrevious={moveToPreviousStage}
        />;
      case 'documents':
        return <DocumentsStage
          lead={lead}
          leadId={leadId}
          onLeadUpdated={setLead}
          data={documentData}
          setData={setDocumentData}
          opportunityId={completedOpportunityId}
          onEnsureOpportunity={ensureOpportunityForClient}
          uploadedBy={user?.id || 1}
          paymentProofFile={paymentData.proofOfPayment instanceof File ? paymentData.proofOfPayment : null}
          onNext={moveToNextStage}
          onPrevious={moveToPreviousStage}
        />;
      case 'agreement':
        return <AgreementStage
          lead={lead}
          data={agreementData}
          setData={setAgreementData}
          quotationData={quotationData}
          paidAmount={paymentData.paidAmount}
          programValidity={(lead as any)?.program_validity || ''}
          opportunityId={completedOpportunityId || (lead as any)?.resolved_opportunity_id || (lead as any)?.opportunity_id}
          onSaveAgreement={saveAgreement}
          onDeleteAgreement={deleteAgreement}
          onNext={moveToNextStage}
          onPrevious={moveToPreviousStage}
        />;
      case 'signed-agreement':
        return <SignedAgreementStage
          lead={lead}
          data={signedAgreementData}
          setData={setSignedAgreementData}
          opportunityId={completedOpportunityId}
          uploadedBy={user?.id || 1}
          complianceStatus={retentionData.agreementComplianceStatus}
          onSubmitCompliance={submitComplianceApproval}
          onNext={moveToNextStage}
          onPrevious={moveToPreviousStage}
        />;
      case 'retained':
        return <RetainedStage
          lead={lead}
          data={retentionData}
          setData={setRetentionData}
          onRefreshCompliance={handleRefreshComplianceStatus}
          onCloseWon={handleCompleteRetention}
          closingWon={closingWon}
          onPrevious={moveToPreviousStage}
          onReject={() => {
            const newStages = [...stages];
            const retainedIndex = newStages.findIndex(s => s.id === 'retained');
            newStages[retainedIndex].status = 'rejected';
            const rejectedIndex = newStages.findIndex(s => s.id === 'retention-rejected');
            newStages[rejectedIndex].status = 'current';
            setStages(newStages);
            setActiveStage('retention-rejected');
          }}
        />;
      case 'retention-rejected':
        return <RetentionRejectedStage
          lead={lead}
          leadId={leadId}
          data={retentionData}
          onResubmit={() => {
            const newStages = [...stages];
            const retainedIndex = newStages.findIndex(s => s.id === 'retained');
            newStages[retainedIndex].status = 'current';
            const rejectedIndex = newStages.findIndex(s => s.id === 'retention-rejected');
            newStages[rejectedIndex].status = 'pending';
            setStages(newStages);
            setActiveStage('retained');
          }}
        />;
      case 'closed':
        return <ClosedStage
          lead={lead}
          leadId={leadId}
          prospectData={prospectData}
          quotationData={quotationData}
          paymentData={paymentData}
          currencyCode={feeData?.currencyCode || 'AED'}
        />;
      default:
        return <div>Select a stage</div>;
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 text-center">Loading opportunity flow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] bg-gray-50">
      <div className="bg-white">
        {/* Header with Lead Info */}
        <div className="p-6 border-b border-gray-200 bg-white shadow-sm">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Opportunity Flow Management</h1>
                <p className="text-gray-600 mt-1">Convert lead to opportunity through the complete workflow</p>
              </div>
              <button
                onClick={() => window.history.back()}
                className="self-start sm:self-auto px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center"
              >
                <ChevronLeft className="mr-1" size={20} />
                Back to Leads
              </button>
            </div>

            {lead && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <User className="mr-2 text-blue-600" size={18} />
                  <span className="font-semibold text-gray-900">{lead.fname} {lead.lname}</span>
                  <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">ID: #{lead.id}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex min-w-0 items-center text-gray-700">
                    <Mail className="mr-2 flex-shrink-0 text-gray-400" size={14} />
                    <span className="truncate">{lead.email}</span>
                  </div>
                  <div className="flex min-w-0 items-center text-gray-700">
                    <Phone className="mr-2 flex-shrink-0 text-gray-400" size={14} />
                    <span className="truncate">{lead.phone}</span>
                  </div>
                  <div className="flex min-w-0 items-center text-gray-700">
                    <Globe className="mr-2 flex-shrink-0 text-gray-400" size={14} />
                    <span className="truncate">{lead.nationality}</span>
                  </div>
                  <div className="flex min-w-0 items-center text-gray-700">
                    <Briefcase className="mr-2 flex-shrink-0 text-gray-400" size={14} />
                    <span className="truncate">{lead.service_interest}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Progress Path */}
        <div className="p-4 sm:p-6 border-b border-gray-200 bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="flex max-w-full flex-wrap items-center gap-2">
              {stages.map((stage, index) => {
                const Icon = stage.icon;
                const isActive = stage.id === activeStage;
                // A stage the flow hasn't reached yet can't be jumped to directly —
                // only stages already completed/current (or rejected, a past state)
                // are navigable. Forward progress only happens one stage at a time
                // via the stage's own "Next"/"Continue" button.
                const isApprovedRetentionReviewTab = stage.id === 'retention-rejected' && retentionData.agreementComplianceStatus === 'approved';
                const isLocked = stage.status === 'pending' && !isApprovedRetentionReviewTab;

                return (
                  <div key={stage.id} className="flex flex-none items-center">
                    <button
                      onClick={() => handleStageClick(stage.id)}
                      disabled={isLocked}
                      title={isLocked ? 'Complete the earlier stages first' : undefined}
                      className={`flex flex-none items-center whitespace-nowrap px-3 py-2 sm:px-4 rounded-lg transition-all ${isActive
                        ? stage.status === 'completed'
                          ? 'bg-green-600 text-white shadow-md'
                          : stage.status === 'rejected'
                            ? 'bg-red-600 text-white shadow-md'
                            : 'bg-blue-600 text-white shadow-md'
                        : stage.status === 'completed'
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : isApprovedRetentionReviewTab
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : stage.status === 'rejected'
                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                      <Icon size={16} className="mr-2 flex-shrink-0" />
                      <span className="text-xs font-medium sm:text-sm">{stage.name}</span>
                      {stage.status === 'completed' && (
                        <CheckCircle size={14} className="ml-2 flex-shrink-0" />
                      )}
                      {stage.status === 'rejected' && (
                        <XCircle size={14} className="ml-2 flex-shrink-0" />
                      )}
                    </button>

                    {index < stages.length - 1 && (
                      <ChevronRight
                        size={16}
                        className={`mx-1 hidden flex-shrink-0 2xl:block ${stage.status === 'completed' ? 'text-green-600' : 'text-gray-300'
                          }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Stage Content */}
        <div className="p-6 bg-gray-50 min-h-[60vh]">
          <div className="max-w-7xl mx-auto">
            {isReadOnly && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                View-only mode: this deal is already marked won. Only CEO and Branch Manager can edit the opportunity flow from the client list.
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeStage}
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={stepVariants}
                transition={{ duration: 0.3 }}
              >
                {isReadOnly && activeStage !== 'closed' ? (
                  <fieldset disabled className="contents">
                    {renderStageContent()}
                  </fieldset>
                ) : renderStageContent()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function validateStage(
  stage: string,
  data: {
    prospectData: ProspectData;
    quotationData: QuotationData;
    paymentData: PaymentData;
    documentData: DocumentData;
    agreementData: AgreementData;
    signedAgreementData: SignedAgreementData;
  },
): string | null {
  const { prospectData, quotationData, paymentData, documentData, agreementData, signedAgreementData } = data;
  const total = Number(quotationData.total);

  if (stage === 'prospect') {
    if (!prospectData.opportunityName.trim()) return 'Enter an opportunity name before continuing.';
    if (!Number.isFinite(Number(prospectData.estimatedValue)) || Number(prospectData.estimatedValue) <= 0) return 'Estimated value must be greater than zero.';
  }

  if (stage === 'quotation') {
    if (!quotationData.validUntil || new Date(`${quotationData.validUntil}T23:59:59`) < new Date()) return 'Set a quotation validity date that is today or later.';
    if (!Number.isFinite(total) || total <= 0) return 'Quotation total must be greater than zero.';
    if (!Number.isFinite(quotationData.discount) || quotationData.discount < 0 || quotationData.discount > quotationData.subtotal) return 'Discount must be between zero and the quotation subtotal.';
    if (!quotationData.items.some((item) => item.description.trim() && Number(item.quantity) > 0 && Number(item.unitPrice) >= 0)) return 'Add at least one complete quotation line item.';
  }

  if (stage === 'payment') {
    const paymentTotal = Number(paymentData.totalAmount || quotationData.total);
    if (!Number.isFinite(paymentTotal) || paymentTotal <= 0) return 'Payment total must be greater than zero.';
    if (!Number.isFinite(paymentData.paidAmount) || paymentData.paidAmount < 0 || paymentData.paidAmount > paymentTotal) return 'Paid amount must be between zero and the payment total.';
    if (!paymentData.paymentDate || Number.isNaN(new Date(paymentData.paymentDate).getTime())) return 'Enter a valid payment date.';
  }

  if (stage === 'documents' && !documentData.allMandatoryDocsUploaded) return 'Upload ID proof, passport copy, and enter the passport number and client actual name before continuing.';

  if (stage === 'agreement') {
    if (!agreementData.agreementTitle.trim()) return 'Enter an agreement title before continuing.';
    if (!agreementData.startDate || !agreementData.endDate || new Date(agreementData.endDate) < new Date(agreementData.startDate)) return 'Agreement end date must be on or after the start date.';
    if (!Number.isFinite(Number(agreementData.amount)) || Number(agreementData.amount) <= 0) return 'Agreement amount must be greater than zero.';
    if (!agreementData.terms.trim()) return 'Enter the agreement terms before continuing.';
    if (!agreementData.counselorConversationSummary.trim()) return 'Counselor conversation summary is required before continuing.';
    if (agreementData.counselorConversationSummary.trim().length < COUNSELOR_SUMMARY_MIN_CHARS) return `Counselor conversation summary must be at least ${COUNSELOR_SUMMARY_MIN_CHARS} characters.`;
  }

  if (stage === 'signed-agreement') {
    if (!signedAgreementData.clientSignature.trim()) return 'Enter the client signature before submitting for approval.';
    if (!signedAgreementData.signatureDate || Number.isNaN(new Date(signedAgreementData.signatureDate).getTime())) return 'Enter a valid signature date.';
  }

  return null;
}

function normalizePriorityForWizard(priority?: string) {
  const value = String(priority || 'medium').toLowerCase();
  if (value === 'critical' || value === 'urgent') return 'critical';
  if (value === 'high') return 'high';
  if (value === 'low') return 'low';
  return 'medium';
}
