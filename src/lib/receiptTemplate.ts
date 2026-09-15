// Centralized payment-receipt branding + HTML template, shared by every
// screen that can print a receipt (Opportunity Flow wizard's Payment/Accounts
// stages, Lead Management's Client List quick-pay, the Clients page
// quick-pay, and Invoices & Payments). Previously each screen kept its own
// copy of this template — some hardcoded per-branch name matching, some a
// flat green theme with no per-branch identity at all — so branches added
// later never got the right company details anywhere except by hand-patching
// every copy.
//
// The document itself follows the company's formal "Tax Invoice / Receipt"
// format: a plain, black-on-white table layout (no per-branch color), with
// every jurisdiction-specific detail — TRN vs GSTIN vs "not applicable",
// VAT vs GST vs no-tax wording, CGST/SGST split, place-of-supply — resolved
// from the branch's own crm_branch record and address text, never hardcoded
// to one specific branch's identity.

import { getBranchAgreementProfile, type BranchBankDetails } from './branchAgreementProfiles';

export interface ReceiptBranchSource {
  name?: string | null;
  // crm_branch.name — the registered legal entity name (e.g. "Disha
  // Management Consultants L.L.C"). `name` above is actually crm_branch.branch
  // in every caller (the short, recognizable label like "Qatar" used for UI
  // display) — legalName is the one receipts/agreements must print as the
  // company name, since a receipt headed just "QATAR" isn't a real company.
  legalName?: string | null;
  nameAr?: string | null;
  address?: string | null;
  email?: string | null;
  mobile?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  vatGstPercent?: number | string | null;
  abbrv?: string | null;
}

export interface ReceiptBranchDetails {
  companyName: string;
  branchName: string;
  branchNameAr: string;
  branchAddress: string;
  branchEmail: string;
  branchPhone: string;
  licenseNumber: string;
  vatGstPercent: number | null;
  // crm_branch.abbrv — the stable branch key the agreement renderer uses to
  // resolve the branch's real legal name/licence/governing law (see
  // branchAgreementProfiles.ts). Receipts don't need this; it's carried
  // through here purely so callers building an agreement from the same
  // lead/opportunity data don't need a second branch lookup.
  branchAbbrv: string;
}

// Only the narrow set of crm_branch columns a receipt/agreement ever needs —
// resolved from whichever shape the caller has on hand: a `dmBranch` object
// (leads), or flat `branchName`/`branchAddress`/... fields (clients list).
export function getLeadBranchDetails(
  leadData: (Record<string, any>) | null | undefined
): ReceiptBranchDetails {
  const dmBranch: ReceiptBranchSource = leadData?.dmBranch || {};
  const branchName = String(
    dmBranch.name ||
    leadData?.branchName ||
    leadData?.branch_name ||
    '',
  ).trim();
  const branchAbbrvForProfile = String(
    dmBranch.abbrv ||
    leadData?.branchAbbrv ||
    leadData?.branch_abbrv ||
    '',
  ).trim();
  // The authoritative legal name is branchAgreementProfiles.ts (same source
  // agreements use) whenever the branch's abbrv is known - keeps receipts and
  // agreements from drifting apart. Falls back to whatever legal name the
  // caller's own query supplied (usually crm_branch.name), then to
  // branchName (the short label) only when nothing else was ever supplied -
  // better an approximate company name than a blank one.
  const legalName = String(
    (branchAbbrvForProfile && getBranchAgreementProfile(branchAbbrvForProfile).legalNameEn) ||
    dmBranch.legalName ||
    leadData?.branchLegalName ||
    leadData?.branch_legal_name ||
    branchName ||
    '',
  ).trim();
  const branchNameAr = String(
    dmBranch.nameAr ||
    leadData?.branchNameAr ||
    leadData?.branch_name_ar ||
    '',
  ).trim();
  const branchAddress = String(
    dmBranch.address ||
    leadData?.branchAddress ||
    leadData?.branch_address ||
    '',
  ).trim();
  const branchEmail = String(
    dmBranch.email ||
    leadData?.branchEmail ||
    leadData?.branch_email ||
    '',
  ).trim();
  const branchPhone = String(
    dmBranch.mobile ||
    dmBranch.phone ||
    leadData?.branchPhone ||
    leadData?.branchMobile ||
    leadData?.branch_mobile ||
    '',
  ).trim();
  const licenseNumber = String(
    dmBranch.licenseNumber ||
    leadData?.branchLicenseNumber ||
    leadData?.branch_license_number ||
    '',
  ).trim();
  // crm_branch.vat_gst_percent is a DECIMAL column, which the MySQL driver
  // returns as a string — coerce here so callers can use it as a number.
  const rawVatGstPercent = dmBranch.vatGstPercent ?? leadData?.branchVatGstPercent ?? leadData?.branch_vat_gst_percent;
  const vatGstPercent = rawVatGstPercent !== null && rawVatGstPercent !== undefined && rawVatGstPercent !== ''
    ? Number(rawVatGstPercent)
    : null;
  const branchAbbrv = String(
    dmBranch.abbrv ||
    leadData?.branchAbbrv ||
    leadData?.branch_abbrv ||
    '',
  ).trim();

  return {
    companyName: legalName || 'Global Navigator LLC FZ',
    branchName: branchName || 'Global Navigator LLC FZ',
    branchNameAr,
    branchAddress,
    branchEmail,
    branchPhone,
    licenseNumber,
    vatGstPercent,
    branchAbbrv,
  };
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const COMPANY_FALLBACK_EMAIL = 'info@navigatorglobals.com';
// GST service-classification code for professional migration/visa consulting
// services — tied to the *type* of service DMC provides, not to any one
// branch, so it's a fixed constant rather than a per-branch database value.
const INDIA_SAC_CODE = '999121';

// GST state codes (India) — used to resolve "Place of Supply" from a
// branch's free-text address so this isn't hardcoded to one branch's city.
// crm_branch has no dedicated state column, so this is matched against the
// address text; a branch whose address doesn't mention a known state name
// simply omits the place-of-supply detail rather than guessing.
const INDIA_GST_STATE_CODES: Record<string, string> = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04',
  'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09',
  'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14',
  'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18', 'west bengal': '19',
  'jharkhand': '20', 'odisha': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24',
  'daman and diu': '25', 'dadra and nagar haveli': '26', 'maharashtra': '27',
  'andhra pradesh': '28', 'karnataka': '29', 'goa': '30', 'lakshadweep': '31', 'kerala': '32',
  'tamil nadu': '33', 'puducherry': '34', 'andaman and nicobar islands': '35',
  'telangana': '36', 'ladakh': '38',
};

function getIndiaStateInfo(address: string | null | undefined): { name: string; code: string } | null {
  const text = String(address || '').toLowerCase();
  const match = Object.keys(INDIA_GST_STATE_CODES)
    .sort((a, b) => b.length - a.length) // longest-first so "Andhra Pradesh" isn't shadowed by a shorter substring
    .find((state) => new RegExp(`\\b${state}\\b`).test(text));
  return match ? { name: titleCase(match), code: INDIA_GST_STATE_CODES[match] } : null;
}

// Standard international (thousand/million) number-to-words — not Indian
// lakh/crore grouping, since this is an internal receipt tool rather than a
// general-purpose Indian numeral formatter.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function threeDigitsToWords(value: number): string {
  let n = value;
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(ONES[Math.floor(n / 100)], 'Hundred');
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]);
    n %= 10;
    if (n) parts.push(ONES[n]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

function integerToWords(value: number): string {
  if (value === 0) return 'Zero';
  const groups: string[] = [];
  let remaining = Math.floor(value);
  let scaleIndex = 0;
  while (remaining > 0) {
    const group = remaining % 1000;
    if (group) {
      groups.unshift(`${threeDigitsToWords(group)}${SCALES[scaleIndex] ? ` ${SCALES[scaleIndex]}` : ''}`);
    }
    remaining = Math.floor(remaining / 1000);
    scaleIndex += 1;
  }
  return groups.join(' ');
}

// e.g. amountInWords(9900, 'AED') -> "AED Nine Thousand Nine Hundred only".
export function amountInWords(amount: number, currency: string): string {
  const safe = Math.max(0, Number(amount) || 0);
  const whole = Math.floor(safe);
  const cents = Math.round((safe - whole) * 100);
  const wholeWords = integerToWords(whole);
  return cents > 0
    ? `${currency} ${wholeWords} and ${integerToWords(cents)} Cents only`
    : `${currency} ${wholeWords} only`;
}

export interface BranchReceiptConfig {
  companyName: string;
  address: string;
  trn: string | null;
  email: string;
  receiptTitle: string;
  hasVat: boolean;
  vatRate: number; // percentage, e.g. 5 for 5%
  taxLabel: 'VAT' | 'GST';
  refLabel: string;
  totalLabel: string;
  // Jurisdiction-specific content — resolved from branch geography, never
  // hardcoded to one branch's identity (see getBranchReceiptConfig below).
  countryLabel: string;
  taxRegLabel: string; // 'Company TRN' | 'Company GSTIN' | 'Tax Registration'
  sacCodeSuffix: string; // ' | SAC Code: 999121' for India, '' otherwise
  noTaxRegNote: string; // populated only when !hasVat
  indiaState: { name: string; code: string } | null;
  residencyStatusLine: string;
  taxNoteSentence: string; // computation note under the totals table
  legalValidityNote: string; // first notes-block bullet
}

// Company identity (name/address/email/licence) always comes from the
// branch's own crm_branch record — never hardcoded — because branch legal
// names collide in ways a name-only lookup can't safely disambiguate (in
// production, "Disha" is the Qatar entity's name, not Kuwait's, and both the
// Abu Dhabi and India entities are named "Didactic ..."). Only the
// geography — read from the combined name+address text, which reliably
// contains the actual city/country — decides tax treatment and wording.
export function getBranchReceiptConfig(
  branchName: string = '',
  currency: string = 'AED',
  branchAddress: string | null = null,
  branchEmail: string | null = null,
  branchLicenseNumber: string | null = null,
  branchVatGstPercent: number | string | null = null,
  branchId: number | string | null = null,
): BranchReceiptConfig {
  void branchId; // retained for call-site stability; no longer used now that per-branch color is gone
  const geo = `${branchName} ${branchAddress || ''}`.toLowerCase();
  const isKuwait = currency === 'KWD' || /kuwait/.test(geo);
  const isQatar = /qatar|doha/.test(geo);
  const isAbuDhabi = /abu\s*dhabi/.test(geo);
  const isIndia = /india|hyderabad/.test(geo);
  const isDubai = /dubai/.test(geo) && !isAbuDhabi;
  const isUae = isDubai || isAbuDhabi || (!isKuwait && !isQatar && !isIndia);

  const vatRate = branchVatGstPercent !== null && branchVatGstPercent !== undefined && branchVatGstPercent !== ''
    ? Number(branchVatGstPercent)
    : (isKuwait || isQatar) ? 0 : isIndia ? 18 : 5;
  const hasVat = vatRate > 0;
  const taxLabel = isIndia ? 'GST' : 'VAT';

  const countryLabel = isUae ? 'United Arab Emirates' : isKuwait ? 'Kuwait' : isQatar ? 'Qatar' : 'India';
  const indiaState = isIndia ? getIndiaStateInfo(branchAddress) : null;

  const taxRegLabel = isIndia ? 'Company GSTIN' : hasVat ? 'Company TRN' : 'Tax Registration';
  const sacCodeSuffix = isIndia ? ` | SAC Code: ${INDIA_SAC_CODE}` : '';
  const noTaxRegNote = !hasVat ? `Not applicable — no VAT or indirect tax registration in ${countryLabel}` : '';

  const half = vatRate / 2;
  const residencyStatusLine = isIndia
    ? (indiaState
      ? `India — ${indiaState.name} (intra-state supply; Place of Supply: ${indiaState.name}, State Code ${indiaState.code})`
      : 'India (Place of Supply: India)')
    : hasVat
      ? `${isUae ? 'UAE' : countryLabel} Resident (${vatRate}% ${taxLabel} applied per this invoice)`
      : `${countryLabel} — no VAT/GST applicable`;

  const taxNoteSentence = isIndia
    ? `Intra-state supply${indiaState ? ` within ${indiaState.name}` : ''} — charged as CGST ${half}% + SGST ${half}% (Total GST ${vatRate}%) under the GST Act 2017.`
    : hasVat
      ? `Standard-rated at ${vatRate}% under UAE VAT Law as the client is UAE-resident. ${taxRegLabel.replace('Company ', '')} shown above is the entity's FTA Tax Registration Number.`
      : `No VAT or indirect tax is applicable in ${countryLabel}. This receipt is issued as a Payment Receipt, not a Tax Invoice.`;

  const legalValidityNote = isIndia
    ? 'This is a computer-generated Tax Invoice under the GST Act 2017. Valid against the Company GSTIN shown above.'
    : hasVat
      ? 'This is a Tax Invoice per UAE Federal Tax Authority requirements. Valid against the Company TRN shown above.'
      : `No VAT or indirect tax is applicable in ${countryLabel}; this is a Payment Receipt, not a Tax Invoice.`;

  return {
    companyName: branchName || 'Global Navigator LLC FZ',
    address: branchAddress || '',
    trn: branchLicenseNumber || null,
    email: branchEmail || '',
    receiptTitle: 'TAX INVOICE / RECEIPT',
    hasVat, vatRate, taxLabel,
    totalLabel: 'TOTAL PAID',
    refLabel: (isKuwait || isQatar) ? 'POS Reference' : 'Bank Reference',
    countryLabel,
    taxRegLabel,
    sacCodeSuffix,
    noTaxRegNote,
    indiaState,
    residencyStatusLine,
    taxNoteSentence,
    legalValidityNote,
  };
}

// Fixed government/registration admin fee, optionally added as a separate
// line on a printed receipt when the counselor checks "Include Admin Fee" at
// receipt generation. It is never part of the service/package fee (Total
// Advisory Fee in the agreement) and never reduces the opportunity's
// remaining balance — it's a distinct charge collected alongside the
// payment, tracked in crm_pay_history so a re-printed receipt still shows it.
export function getAdminFeeAmount(branchName: string = '', branchAddress: string | null = null, currency: string = ''): number {
  const geo = `${branchName} ${branchAddress || ''}`.toLowerCase();
  const isKuwait = currency === 'KWD' || /kuwait/.test(geo);
  const isIndia = /india|hyderabad/.test(geo);
  if (isIndia) return 0; // no admin fee in India
  if (isKuwait) return 10; // KWD
  return 120; // AED — Dubai, Abu Dhabi, Qatar, and any other Gulf branch
}

// The admin fee itself is subject to standard 5% VAT when charged from a
// Dubai or Abu Dhabi branch (AED 120 admin fee + 5% VAT = AED 126 total) —
// matching those two branches' own VAT rate elsewhere on this receipt.
// Qatar/Kuwait/India admin fees stay VAT-free, matching their tax treatment
// in getBranchReceiptConfig above.
export function getAdminFeeVatRate(branchName: string = '', branchAddress: string | null = null): number {
  const geo = `${branchName} ${branchAddress || ''}`.toLowerCase();
  const isAbuDhabi = /abu\s*dhabi/.test(geo);
  const isDubai = /dubai/.test(geo) && !isAbuDhabi;
  return (isDubai || isAbuDhabi) ? 5 : 0;
}

// Generalizes the payment-method -> reference-label inference that used to
// live ad hoc in individual screens (POS terminals get "POS Reference",
// Indian bank transfers get "UTR Reference", everything else falls back to
// the branch's own default).
export function getReferenceLabel(paymentMethod: string | null | undefined, cfg: BranchReceiptConfig): string {
  const m = String(paymentMethod || '').toLowerCase();
  if (/pos|terminal|card/.test(m)) return 'POS Reference';
  if (cfg.taxLabel === 'GST' && /neft|rtgs|imps|transfer|bank/.test(m)) return 'UTR Reference';
  return cfg.refLabel;
}

export interface ReceiptFields {
  receiptNumber?: string | null;
  paymentNumber?: string | null;
  paymentDate?: string | Date | null;
  clientName?: string | null;
  email?: string | null;
  phone?: string | null;
  passportNumber?: string | null;
  agreementNumber?: string | null;
  opportunityId?: number | string | null;
  serviceName?: string | null;
  consultantName?: string | null;
  companyName?: string | null;
  branchId?: number | string | null;
  branchName?: string | null;
  branchAddress?: string | null;
  branchEmail?: string | null;
  branchPhone?: string | null;
  // crm_branch.abbrv — resolves the branch's bank details (see
  // branchAgreementProfiles.ts) the same way agreements resolve legal text.
  branchAbbrv?: string | null;
  licenseNumber?: string | null;
  vatGstPercent?: number | string | null;
  paymentMethod?: string | null;
  transactionId?: string | null;
  currency?: string | null;
  totalAmount?: number | string | null;
  previouslyPaid?: number | string | null;
  paidAmount?: number | string | null;
  remainingBalance?: number | string | null;
  remark?: string | null;
  adminFeeIncluded?: boolean;
  adminFeeAmount?: number | string | null;
}

// Shared by every screen that prints a payment receipt so they all render
// the exact same formal receipt layout — and the same per-branch tax
// treatment — instead of maintaining divergent copies.
//
// Layout matches the signed "Official Payment Receipt" format (logo,
// letterhead + bank-details box, file no., flat total inclusive of tax,
// stamp) rather than the older itemized tax-invoice table — the amount and
// tax-rate math (VAT/GST split, admin fee) is still computed per branch so
// the numbers stay correct, it's just no longer broken out line-by-line on
// the printed page.
export function buildReceiptHtml(r: ReceiptFields): string {
  const cfg = getBranchReceiptConfig(
    r.branchName || r.companyName || '',
    r.currency || 'AED',
    r.branchAddress || null,
    r.branchEmail || null,
    r.licenseNumber || null,
    r.vatGstPercent ?? null,
    r.branchId ?? null,
  );
  const currency = r.currency || 'AED';
  const companyName = r.companyName || cfg.companyName;
  const branchAddress = (r.branchAddress || cfg.address || '').replace(/\n/g, ', ');
  const branchPhone = r.branchPhone || '';
  const branchEmail = r.branchEmail || cfg.email || COMPANY_FALLBACK_EMAIL;
  const bank: BranchBankDetails | undefined = getBranchAgreementProfile(r.branchAbbrv).bankDetails;
  const fmt = (n: number) => `${currency} ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const totalAmount = Number(r.totalAmount || 0);
  const paidAmount = Number(r.paidAmount || 0);
  const hasPreviouslyPaid = r.previouslyPaid !== undefined && r.previouslyPaid !== null;
  const previouslyPaid = Number(r.previouslyPaid || 0);
  const balance = r.remainingBalance !== undefined && r.remainingBalance !== null
    ? Number(r.remainingBalance)
    : Math.max(0, totalAmount - paidAmount);

  // Admin fee is a separate charge added to what's shown as collected on
  // this printed receipt — it never affects paidAmount/balance elsewhere
  // (agreement totals, opportunity remaining balance), only this document's
  // own total-due line.
  const adminFeeAmount = r.adminFeeIncluded ? Math.max(0, Number(r.adminFeeAmount || 0)) : 0;
  const adminFeeVatRate = adminFeeAmount > 0 ? getAdminFeeVatRate(companyName, branchAddress) : 0;
  const adminFeeVatAmount = adminFeeAmount * (adminFeeVatRate / 100);
  const receiptTotal = paidAmount + adminFeeAmount + adminFeeVatAmount;

  const fileNo = r.agreementNumber || (r.opportunityId !== undefined && r.opportunityId !== null && r.opportunityId !== '' ? String(r.opportunityId) : 'N/A');
  const dateStr = new Date(r.paymentDate || new Date()).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  const purpose = r.serviceName || 'Professional Migration & Visa Consulting Services';
  const accountLabel = /kuwait/i.test(cfg.countryLabel) ? 'Kuwait Account'
    : /qatar/i.test(cfg.countryLabel) ? 'Qatar Account'
    : /india/i.test(cfg.countryLabel) ? 'India Account'
    : 'UAE Account';
  const docTitle = cfg.hasVat ? 'TAX INVOICE' : 'PAYMENT RECEIPT';
  const totalLabel = `Total Amount Received${cfg.hasVat ? ` inclusive ${cfg.taxLabel} ${cfg.vatRate}%` : ''}`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Official Payment Receipt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;color:#1a1a1a;font-size:10.5pt;padding:28px 46px 36px}
  .logo{display:block;margin:0 auto 14px;height:64px;object-fit:contain}
  table.letterhead{width:100%;border-collapse:collapse;margin-bottom:14px}
  table.letterhead td{border:1.5px solid #1a1a1a;padding:10px 14px;font-size:9.6pt;vertical-align:top}
  table.letterhead .bold{font-weight:700}
  table.letterhead a{color:#1a1a1a}
  .doc-title{text-align:center;font-size:13pt;font-weight:700;letter-spacing:.4px;margin:6px 0 10px}
  table.info{width:100%;border-collapse:collapse;margin-bottom:0}
  table.info td{border:1px solid #1a1a1a;padding:7px 12px;font-size:9.8pt;vertical-align:top}
  table.info td.label{font-weight:700;width:60%}
  table.info td.amount{width:40%;text-align:right;font-weight:700}
  table.info tr.fileno td{background:#5CE1E6}
  table.info tr.total td{font-weight:700;border-top:2px solid #1a1a1a}
  .below{display:flex;justify-content:space-between;align-items:flex-start;margin-top:18px;gap:24px}
  .below .field{font-size:9.8pt;margin-bottom:8px}
  .stamp{width:130px;height:130px;border:3px double #1a3a8f;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;color:#1a3a8f;font-weight:700;font-size:7.6pt;line-height:1.3;transform:rotate(-8deg);padding:8px}
  .note{font-size:9.3pt;margin-top:4px}
  @media print{@page{size:A4 portrait;margin:0}body{padding:20px 38px 24px}}
</style></head><body>
<img class="logo" src="/logo.png" alt="Global Navigator"/>

<table class="letterhead">
  <tr>
    <td>
      <div class="bold">${companyName.toUpperCase()}</div>
      ${branchAddress ? branchAddress.split(',').map((line, i, arr) => `<div${i === 0 ? ' class="bold"' : ''}>${line.trim()}${i < arr.length - 1 ? ',' : ''}</div>`).join('') : ''}
      ${branchPhone ? `<div>Phone: ${branchPhone}</div>` : ''}
      <div>Email: <a href="mailto:${branchEmail}">${branchEmail}</a></div>
      ${bank ? `
      <div style="margin-top:8px" class="bold">Bank Details:</div>
      <div>${bank.accountHolderName}</div>
      <div>Account number: ${bank.accountNumber}</div>
      <div>IBAN: ${bank.iban}</div>
      <div>BIC: ${bank.bic}</div>
      ` : ''}
    </td>
  </tr>
</table>

<div class="doc-title">OFFICIAL PAYMENT RECEIPT</div>

<table class="info">
  <tr><td class="label">Date:</td><td class="amount">${dateStr}</td></tr>
  <tr><td class="label" colspan="2">${docTitle}</td></tr>
  <tr class="fileno"><td class="label" colspan="2">Client File No: ${fileNo}</td></tr>
  <tr><td class="label">Received From: ${r.clientName || 'Client'}</td><td class="amount">${fmt(paidAmount)}</td></tr>
  ${hasPreviouslyPaid ? `<tr><td class="label">Total Package Amount</td><td class="amount">${fmt(totalAmount)}</td></tr><tr><td class="label">Previously Paid</td><td class="amount">${fmt(previouslyPaid)}</td></tr>` : ''}
  ${adminFeeAmount > 0 ? `<tr><td class="label">Administration Fee${adminFeeVatAmount > 0 ? ` (incl. ${adminFeeVatRate}% VAT)` : ''}</td><td class="amount">${fmt(adminFeeAmount + adminFeeVatAmount)}</td></tr>` : ''}
  <tr class="total"><td class="label">${totalLabel}</td><td class="amount">${fmt(receiptTotal)}</td></tr>
  ${hasPreviouslyPaid ? `<tr class="total"><td class="label">Balance Remaining</td><td class="amount">${fmt(balance)}</td></tr>` : ''}
</table>

<div class="below">
  <div>
    <div class="field"><strong>Payment Method:</strong> ${titleCase(r.paymentMethod || 'Cash')}${/transfer/i.test(r.paymentMethod || '') ? ` to ${accountLabel}` : ''}</div>
    ${r.transactionId ? `<div class="field"><strong>${getReferenceLabel(r.paymentMethod, cfg)}:</strong> ${r.transactionId}</div>` : ''}
    <div class="field"><strong>Purpose:</strong> ${purpose}</div>
    <div class="note">Advance amount paid is not refundable.</div>
    ${r.remark ? `<div class="note"><strong>Remark:</strong> ${r.remark}</div>` : ''}
  </div>
  <div class="stamp">${companyName.toUpperCase()}<br/>${cfg.countryLabel}</div>
</div>
</body></html>`;
}

export function printReceipt(r: ReceiptFields): boolean {
  const html = buildReceiptHtml(r);
  const win = window.open('', '_blank', 'width=860,height=1100');
  if (!win) { window.toast.warning('Allow pop-ups to view the receipt.'); return false; }
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', () => setTimeout(() => win.print(), 300));
  if (win.document.readyState === 'complete') setTimeout(() => win.print(), 500);
  return true;
}
