// "Agreement for Services" — Work Permit / overseas-employment placement
// programs (Global Navigator L.L.C. FZ), taken verbatim from the signed
// "Draft Copy - EU Agreement" PDF.
//
// Structural differences from every branch file in branchAgreementProfiles.ts
// (Abu Dhabi/Dubai/Kuwait/Qatar/Hyderabad):
//   - English-only, 15 numbered clauses with a completely different clause
//     set (no VAT/TRN header block, no Emirates ID/passport identification
//     block, no bilingual layout) — this is not a "Gulf" or "India" variant,
//     it's a separate program-type document.
//   - Annexure A's fee table has two layouts depending on how the client is
//     paying: "Upfront Plan" (Total Fee / Registration) or "Stage Wise"
//     (Total Fee Charges / Registration / Job Confirmation / Work Permit).
//     Neither layout is specific to the EU program — programInterested and
//     countryInterested are plain dynamic fields, so the same template
//     serves any work-permit-style program (only the visible copy differs).
//   - Annexure B is a full standalone Refund Policy with its own signature
//     block, distinct from the main Agreement/Annexure A signature lines.
//
// Company identity/bank details default to the Dubai profile
// (branchAgreementProfiles.ts) since that's the entity on the signed PDF —
// pass companyOverrides/bankDetails explicitly for a different entity.

import { getBranchAgreementProfile, type BranchBankDetails } from './branchAgreementProfiles';

const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface WorkPermitFeeStages {
  planType: 'upfront' | 'stage_wise';
  currencyCode?: string;
  totalFee: string | number;
  registrationFee: string | number;
  // Stage-wise only.
  jobConfirmationFee?: string | number;
  workPermitFee?: string | number;
}

export interface WorkPermitAgreementValues {
  fileNumber: string;
  agreementDate: string;
  clientName: string;
  // "Father/Mother name" field on the signed PDF.
  parentName?: string;
  clientMobile: string;
  clientEmail?: string;
  clientAddress?: string;
  // Both plain dynamic fields — this template isn't hardcoded to any one
  // program or destination, only the signed PDF's example happened to be
  // "EU Work Permit" / "Europe".
  programInterested: string;
  countryInterested: string;
  // Used only in Annexure B item 4 ("Employer Document-Related Refusal") —
  // defaults to countryInterested when not given.
  employerRegionLabel?: string;
  fees: WorkPermitFeeStages;
  // Annexure B execution block.
  signerName?: string;
  signatureDate?: string;
  signaturePlace?: string;
  // Company identity — defaults to the Dubai/Global Navigator profile.
  branchAbbrv?: string | null;
}

function money(amount: string | number | undefined, currencyCode: string): string {
  if (amount === undefined || amount === null || amount === '') return '—';
  const n = Number(amount);
  return Number.isFinite(n) ? `${currencyCode} ${n.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : esc(amount);
}

// The repeated acknowledgment + signature line that follows almost every
// page of the signed PDF.
function ackBlock(): string {
  return `
  <div class="ack">
    The terms and conditions governing the provision of immigration services (&ldquo;Agreement&rdquo;) are outlined below. It is imperative that
    you carefully review and fully understand these terms before proceeding to enter into this Agreement. Should you wish to obtain
    independent legal advice, we strongly encourage you to do so prior to signing this Agreement. By signing at the bottom of each page,
    you acknowledge that you have thoroughly reviewed and comprehended the terms stated therein. I hereby acknowledge that I have read
    and fully understood the terms and conditions outlined in the subsequent pages and agree to adhere to the provisions of this Agreement.
  </div>
  <div class="sig-line">Signature: <span class="fill"></span></div>`;
}

export function renderWorkPermitAgreement(v: WorkPermitAgreementValues): string {
  const profile = getBranchAgreementProfile(v.branchAbbrv || 'dxb szr');
  const bank: BranchBankDetails | undefined = profile.bankDetails;
  const companyName = profile.legalNameEn;
  const companyAddress = profile.addressEn;
  const contactLine = profile.contactLineEn || '';
  const [, phone, email] = contactLine.match(/Phone:\s*([^|]+)\s*\|\s*Email:\s*(.+)/) || [];
  const companyPhone = (phone || '').trim();
  const companyEmail = (email || '').trim() || 'info@navigatorglobals.com';

  const currency = v.fees.currencyCode || 'AED';
  const employerRegion = v.employerRegionLabel || v.countryInterested;
  const clientAddress = v.clientAddress || `${companyAddress}`;

  const feeTable = v.fees.planType === 'stage_wise'
    ? `
    <div class="stage-label">Stage Wise</div>
    <table class="fee-table">
      <tr><th>Total Fee Charges</th><th>Registration</th><th>Job Confirmation</th><th>Work Permit</th></tr>
      <tr>
        <td>${money(v.fees.totalFee, currency)}</td>
        <td>${money(v.fees.registrationFee, currency)}</td>
        <td>${money(v.fees.jobConfirmationFee, currency)}</td>
        <td>${money(v.fees.workPermitFee, currency)}</td>
      </tr>
    </table>`
    : `
    <div class="stage-label">Upfront Plan</div>
    <table class="fee-table">
      <tr><th>Total Fee</th><th>Registration</th></tr>
      <tr>
        <td>${money(v.fees.totalFee, currency)}</td>
        <td>${money(v.fees.registrationFee, currency)}</td>
      </tr>
    </table>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Agreement for Services - ${esc(v.fileNumber)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,sans-serif;color:#1a1a1a;font-size:10.3pt;line-height:1.45;margin:0;padding:26px 46px 60px}
  .logo{display:block;margin:0 auto 10px;height:56px;object-fit:contain}
  h1.title{text-align:center;font-size:14pt;font-weight:700;margin:6px 0 2px}
  .file-no{text-align:center;font-weight:700;font-size:10pt;margin-bottom:14px}
  table.header-fields{width:100%;border-collapse:collapse;margin-bottom:12px}
  table.header-fields td{padding:2px 6px;font-size:10pt;vertical-align:top}
  table.header-fields td.label{width:34%;font-weight:400}
  h2.clause{font-size:11.3pt;font-weight:700;margin:16px 0 6px;page-break-after:avoid}
  h3.annex-title{text-align:center;font-size:12.5pt;font-weight:700;margin:0 0 2px}
  h3.annex-sub{text-align:center;font-size:10.6pt;font-weight:700;margin:0 0 12px}
  ol.clauses{padding-left:18px;margin:0 0 8px}
  ol.clauses > li{margin-bottom:6px}
  ol.sub{padding-left:18px;margin:4px 0}
  p{margin:0 0 8px}
  .ack{font-size:8.3pt;color:#333;margin:22px 0 6px;page-break-inside:avoid}
  .sig-line{font-size:9.5pt;margin-bottom:6px;page-break-inside:avoid}
  .fill{display:inline-block;min-width:180px;border-bottom:1px solid #1a1a1a;height:1px}
  .section-break{page-break-before:always}
  table.fee-table{width:100%;border-collapse:collapse;margin:8px 0 14px}
  table.fee-table th{background:#3aa15a;color:#fff;padding:6px 8px;font-size:9.5pt;text-align:center}
  table.fee-table td{border:1px solid #999;padding:10px 8px;text-align:center;font-size:9.8pt}
  .stage-label{font-weight:700;margin:10px 0 4px}
  table.bank-table{width:100%;border-collapse:collapse;margin:10px 0}
  table.bank-table td{border:1px solid #999;padding:6px 10px;font-size:9.6pt}
  table.bank-table td.k{background:#3aa15a;color:#fff;font-weight:700;width:32%}
  .footer-bar{text-align:center;font-size:8.6pt;color:#333;margin-top:26px;border-top:2px solid #1a3a8f;padding-top:6px}
  @media print{@page{size:A4 portrait;margin:14mm 12mm}}
</style></head><body>

<img class="logo" src="/logo.png" alt="Global Navigator"/>
<h1 class="title">AGREEMENT FOR SERVICES</h1>
<div class="file-no">FILE No- ${esc(v.fileNumber)}</div>

<table class="header-fields">
  <tr><td class="label">Service Provider Name:</td><td>${esc(companyName)}.</td></tr>
  <tr><td class="label">Name of the Client:</td><td>Mr./Ms. ${esc(v.clientName)}</td></tr>
  <tr><td class="label">Father/Mother name:</td><td>${esc(v.parentName || '—')}</td></tr>
  <tr><td class="label">Mobile No:</td><td>${esc(v.clientMobile)}</td></tr>
  <tr><td class="label">Email:</td><td>${esc(v.clientEmail || 'Not Applicable')}</td></tr>
  <tr><td class="label">Address:</td><td>${esc(clientAddress)}</td></tr>
  <tr><td class="label">Email:</td><td><a href="mailto:${esc(companyEmail)}">${esc(companyEmail)}</a></td></tr>
  <tr><td class="label">Phone:</td><td>${esc(companyPhone)}</td></tr>
  <tr><td class="label">Program Interested:</td><td>${esc(v.programInterested)}</td></tr>
  <tr><td class="label">Country Interested:</td><td>${esc(v.countryInterested)}</td></tr>
</table>

<p>This immigration Services Agreement (&ldquo;Agreement&rdquo;) is made and entered into as of dated: ${esc(v.agreementDate)}, by and
between ${esc(companyName)}. Dubai, UAE. (hereinafter referred to as Navigator) a professional immigration
consultancy firm having its principal place of business at ${esc(companyAddress)}
and Client Name: Mr./Ms. ${esc(v.clientName)} (hereinafter referred to as "client), an individual residing at client address
Dubai, UAE.</p>

<p>The parties agree as follows:</p>

<h2 class="clause">1. Definitions and Interpretation</h2>
<ol class="clauses">
  <li>"Services" refers to the immigration consultancy services specified in Annexure A.</li>
  <li>"Confidential Information" refers to all non-public information provided by one party to the other for the purpose of fulfilling this Agreement.</li>
  <li>Interpretation: Words importing the singular include the plural and vice versa, and references to any statutory provision include modifications or re-enactments thereof.</li>
</ol>

<h2 class="clause">2. Purpose</h2>
<ol class="clauses">
  <li>This Agreement governs the relationship between Navigator and the Client for the provision of resettlement services as specified in Annexure A.</li>
</ol>

${ackBlock()}

<div class="section-break"></div>

<h2 class="clause">3. Responsibilities of Navigator</h2>
<ul class="clauses" style="list-style:none;padding-left:0">
  <li>- Navigator agrees to perform the Services outlined in Annexure A with professionalism and diligence. Navigator shall provide updates on the progress of the Client&rsquo;s immigration application and address any client queries within a reasonable time frame.</li>
  <li>- Navigator does not guarantee approval of any visa application, as decisions are subject to immigration authorities / respective embassies and government bodies.</li>
</ul>

<h2 class="clause">4. Responsibilities of the Client</h2>
<ol class="clauses">
  <li>The Client shall provide all necessary documents and accurate information required for the provision of the Services.</li>
  <li>The Client agrees to:
    <ul style="list-style:none;padding-left:14px">
      <li>- Respond to requests for additional information or clarification within the specified time frame.</li>
      <li>- Refrain from contacting immigration authorities / lawyers / agents / entity / Government organizations directly without prior written approval from NAVIGATOR.</li>
    </ul>
  </li>
  <li>Pay all fees as outlined in Annexure A within the agreed-upon time frames.
    <ul style="list-style:none;padding-left:14px">
      <li>- The Client acknowledges that any misinformation or delay may impact the outcome of the Services.</li>
    </ul>
  </li>
</ol>

<h2 class="clause">5. Fees and Payment Terms</h2>
<ol class="clauses">
  <li>All fees and charges associated with the Services are detailed in Annexure A.</li>
  <li>Payments must be made in accordance with the schedule specified in Annexure A. Non-payment of fees may result in the suspension or termination of Services.</li>
  <li>Fees are non-refundable except as explicitly stated in Annexure A or required by applicable law.</li>
</ol>

<h2 class="clause">6. Confidentiality</h2>
<ol class="clauses">
  <li>Both parties agree to maintain the confidentiality of all Confidential Information received under this Agreement.</li>
  <li>Confidential Information shall only be disclosed to third parties with prior written consent or as required by law.</li>
</ol>

${ackBlock()}

<div class="section-break"></div>

<ol class="clauses" start="3">
  <li style="list-style:none;margin-left:-18px">Client acknowledges and agrees that his/her details will be shared by NAVIGATOR for the purposes of immigration process with the third parties including without limitation agents for Education assessments, Notary, IELTS government bodies and independent recruiters and similar other institutions/agents and share the Client&rsquo;s details for marketing and branding for promotional activities.</li>
</ol>

<h2 class="clause">7. Termination</h2>
<ol class="clauses">
  <li>Either party may terminate this Agreement with fourteen (14) days&rsquo; prior written notice.</li>
  <li>NAVIGATOR may terminate this Agreement immediately if the Client breaches any material terms of this Agreement.</li>
</ol>
<p><strong>Consequences of Termination</strong></p>
<ol class="clauses">
  <li>Upon termination, NAVIGATOR will cease all Services.</li>
  <li>The Client remains liable for any unpaid fees and charges.</li>
</ol>

<h2 class="clause">8. Force Majeure</h2>
<ol class="clauses">
  <li>Neither Party shall be held liable for failing to fulfill its obligations under this Agreement if such failure arises from causes beyond their reasonable control, including but not limited to acts of God, earthquakes, fires, floods, embargoes, catastrophes, sabotage, utility or transmission failures, government restrictions or regulations, national emergencies, insurrections, riots, wars, or viruses not caused by the actions or negligence of the Party, its employees, or agents. Other such causes include strikes, work stoppages, labor disputes, unavailability or delays in transportation, and supplier defaults (collectively referred to as a "Force Majeure Event"). In addition, no refunds will be applicable in the event of the death of any person. The period for performance of any obligations under this Agreement shall be extended by the duration of the delay caused by the Force Majeure Event. If the Force Majeure Event continues for a period exceeding ninety (90) days, either Party may terminate this Agreement.</li>
</ol>

<h2 class="clause">9. Dispute Resolution</h2>
<ol class="clauses">
  <li>Any disputes arising under this Agreement shall first be addressed through good-faith negotiations within thirty working (30) days of notice of the dispute.</li>
  <li>If unresolved, the dispute shall be referred to the court of United Arab Emirates.</li>
</ol>

<h2 class="clause">10. Governing Law</h2>
<ol class="clauses">
  <li>This Agreement shall be governed by and construed in accordance with the laws of United Arab Emirates.</li>
</ol>

<h2 class="clause">11. Entire Agreement</h2>
<ol class="clauses">
  <li>This Agreement, including Annexure A, constitutes the entire agreement between the parties concerning the subject matter and supersedes all prior discussions and agreements.</li>
  <li>No amendments or modifications to this Agreement shall be effective unless in writing and signed by both parties.</li>
</ol>

${ackBlock()}

<div class="section-break"></div>

<h2 class="clause">12. Limitation of Liability</h2>
<ol class="clauses">
  <li>NAVIGATOR shall not be held liable for: Any delays, losses, or rejections caused by incorrect or incomplete information provided by the Client. Changes in immigration laws, policies, or procedures that affect the outcome of the application. The parties to this agreement shall take note that in case of any human errors, wherein the client applications may not be considered or returned by the Government due to such errors, in such an event, NAVIGATOR shall be liable to rectify and refile the application with the authorities. Retainer (Lawyer fee, if any) and Government fees will be charged as per actual.</li>
  <li>The Client acknowledges that the final decision on any immigration application lies with the relevant authorities, and NAVIGATOR cannot influence the outcome.</li>
</ol>

<h2 class="clause">13. Retention and Return of Documents</h2>
<ol class="clauses">
  <li>NAVIGATOR will retain the Client's documents for a period of 18 months from the date of submission or until the conclusion of the Services, whichever is earlier.</li>
  <li>The Client is required to collect original documents within 21 days of notification from NAVIGATOR.</li>
  <li>NAVIGATOR shall not be liable for the loss or destruction of documents if the Client fails to collect them within the specified time frame.</li>
</ol>

<h2 class="clause">14. Annexure</h2>
<ol class="clauses">
  <li>Annexure A, attached hereto, details the specific Services, payment schedules, and any additional terms and conditions.</li>
  <li>Annexure A &amp; B shall be deemed an integral part of this Agreement.</li>
</ol>

<h2 class="clause">15. Execution</h2>
<ol class="clauses">
  <li>By signing below, both parties acknowledge and agree to the terms and conditions of this Agreement.</li>
</ol>

${ackBlock()}

<div class="section-break"></div>

<h3 class="annex-title">Annexure A</h3>
<h3 class="annex-sub">Scope of Services and Payment Terms</h3>

<p>This Annexure forms an integral part of the Immigration Services Agreement dated: ${esc(v.agreementDate)} between
<strong>${esc(companyName.toUpperCase())}</strong> (hereinafter referred to as "NAVIGATOR ") and Mr./Ms.
${esc(v.clientName)} (hereinafter referred to as "Client").</p>

<h2 class="clause">1. Appointment and Mandate</h2>
<ol class="clauses">
  <li>The Client formally appoints NAVIGATOR to provide professional resettlement services. These services include guiding the Client through the process of obtaining resettlement-related permits, such as ${esc(v.programInterested)}.</li>
</ol>

<h2 class="clause">2. Scope of Services and NAVIGATOR&rsquo;S obligations</h2>
<ol class="clauses">
  <li>NAVIGATOR services begin with pre-application support, including an initial assessment of the Client's eligibility and providing detailed instructions on required documentation.</li>
  <li>While NAVIGATOR offers comprehensive support, it does not assist in securing employment or job offers unless explicitly stated in the Agreement. The Client acknowledges that NAVIGATOR role is limited to consultancy and advisory support.</li>
  <li>NAVIGATOR will share the details of the work done on the file if the file is not successful.</li>
  <li>NAVIGATOR is not responsible for obtaining refunds of money the Client pays directly to other entities, and the Client understands that they will be subject to the refund policies of the government or organization that is involved.</li>
  <li>If NAVIGATOR pays government fees on a client&rsquo;s behalf, the Client must contact the government body for a refund. NAVIGATOR will not reimburse the Client for this amount.</li>
  <li>If a refund option exists, NAVIGATOR will give the Client instructions on how to recover pre-paid government fees.</li>
</ol>

${ackBlock()}

<div class="section-break"></div>

${feeTable}

<ol class="clauses" start="2">
  <li>Any additional services requested by the Client, or costs incurred due to changes in immigration policies or client circumstances, will attract extra charges.</li>
  <li>Third-party fees, such as government filing fees, medical examinations, and document translations, are not included in the professional fee and remain the responsibility of the Client.</li>
  <li>Payments made are non-refundable unless explicitly stated otherwise. Partial refunds, if applicable, will be processed after deducting NAVIGATOR administrative and legal charges.</li>
  <li>Not paying the due amount within the stipulated time given and without the prior consent of NAVIGATOR, will suspend/put this Agreement on hold, and no further services will occur until the due payment is received.</li>
  <li>Not paying the balance requested within ten (10) calendar days will automatically terminate this Agreement.</li>
  <li>Clients can make Payments by Cheque, Credit/Debit Card, Bank Transfer, Cash, or online payments. All Cash Transactions should always be done in company premises and receipts would have the company stamp on it if not Navigator is not liable for any damages cost to client.</li>
</ol>

${bank ? `
<table class="bank-table">
  <tr><td class="k">Bank Name:</td><td>${esc(bank.bankName)}</td></tr>
  <tr><td class="k">Account Number:</td><td>${esc(bank.accountNumber)}</td></tr>
  <tr><td class="k">IBAN</td><td>${esc(bank.iban)}</td></tr>
  <tr><td class="k">BIC:</td><td>${esc(bank.bic)}</td></tr>
  <tr><td class="k">Bank</td><td>${esc(bank.bankAddress || '')}</td></tr>
  <tr><td class="k">Account holder Name:</td><td>${esc(bank.accountHolderName)}</td></tr>
</table>` : ''}

<h2 class="clause">4. Client Obligations</h2>
<ol class="clauses">
  <li>The Client must supply all required documents as specified by the visa processing authorities. All information provided to NAVIGATOR must be accurate, current, and truthful. The Client assumes responsibility for reviewing and ensuring the accuracy of any forms or documents they sign before submitting them to NAVIGATOR.</li>
  <li>Additionally, the Client agrees not to sign any forms or documents from government bodies or third parties without prior review and approval by NAVIGATOR. All documentation must be in English or a legally recognized alternate language, accompanied by certified translations.</li>
  <li>Translations must include a sworn statement from a qualified translator fluent in both the original language and English. The Client, their relatives, or any unqualified persons may not serve as translators.</li>
</ol>

${ackBlock()}

<div class="section-break"></div>

<ol class="clauses" start="4">
  <li style="list-style:none;margin-left:-18px">The Client confirms that neither they nor their dependents have any severe communicable medical conditions, criminal records, or security issues that may affect the application process. All medical, criminal, and security background checks mandated by the immigration authorities must be successfully passed. NAVIGATOR shall not be liable for any application denial resulting from adverse findings during these checks.</li>
  <li style="list-style:none;margin-left:-18px">Accuracy and honesty in representations are essential. The Client agrees not to provide false, misleading, or inaccurate information. Any attempt at misrepresentation may result in application rejection, future bans from entry, criminal charges, or other adverse legal consequences. The Client acknowledges full responsibility for any repercussions resulting from such actions.</li>
  <li style="list-style:none;margin-left:-18px">The Client and their dependents may be required to attend interviews at visa offices, which may be located outside their country of residence. The Client agrees to attend such interviews and will not sign any documents during the process without understanding their content. If necessary, the Client has the right to consult with NAVIGATOR before taking such actions. NAVIGATOR shall not be held responsible for adverse outcomes due to the Client&rsquo;s failure to attend scheduled interviews or comply with requirements.</li>
  <li style="list-style:none;margin-left:-18px">The Client must maintain sufficient settlement funds as mandated by immigration authorities. These funds must be legally sourced and verifiable, with proper documentation presented during the application process and upon arrival at the destination country. Any failure to provide adequate proof of funds or their source may result in rejection at the border or denial of the application. NAVIGATOR does not offer assistance with travel arrangements or fund transfers, which remain the Client&rsquo;s sole responsibility.</li>
  <li style="list-style:none;margin-left:-18px">The Client agrees to communicate with NAVIGATOR primarily through email and in English. If a translator is used, the Client bears all responsibility for the quality and accuracy of translations. The Client must promptly notify NAVIGATOR of any direct communication received from government authorities or other organizations and should refrain from responding until receiving instructions from NAVIGATOR.</li>
  <li style="list-style:none;margin-left:-18px">The Client acknowledges that they shall not instruct their financial institutions to dishonor payments made to NAVIGATOR. Any returned payments or bounced cheques will incur additional charges as per NAVIGATOR&rsquo;s policy. Fees charged by NAVIGATOR are for professional services rendered, including preparation and filing of applications. Once services are retained, fees become due and are non-refundable, irrespective of the application outcome or the payment stage chosen by the Client.</li>
</ol>

${ackBlock()}

<div class="section-break"></div>

<h2 class="clause">5. Term and Termination</h2>
<ol class="clauses">
  <li>This Annexure is valid for (12) months from the date of signing the main Agreement.</li>
  <li>Either party may terminate the Annexure by providing 14 working days&rsquo; written notice.</li>
  <li>In the event of termination, the Client must settle any outstanding fees and charges. NAVIGATOR reserves the right to terminate the Agreement if the Client fails to meet their obligations, provides false information, or engages in any actions that compromise the integrity of the process.</li>
  <li>If the Client misbehaves or use abusive language with any of Navigator&rsquo;s employee/representative ${esc(companyName.toUpperCase())}. holds the right to terminate the contract.</li>
</ol>

<p><strong>Acknowledgment</strong></p>
<ol class="clauses">
  <li>By signing this Annexure, the Client acknowledges that they have read and understood the scope of services, payment terms, and associated conditions. The Client agrees to comply with the terms outlined herein.</li>
</ol>

${ackBlock()}

<div class="section-break"></div>

<h3 class="annex-title">Annexure B</h3>
<h3 class="annex-sub">Refund Policy</h3>

<p>This Refund Policy ("Annexure") is part of the Agreement entered into between NAVIGATOR and the Client Mr./Ms.
${esc(v.clientName)}. This Annexure outlines the conditions under which the Client may or may not be entitled
to a refund for the services provided by NAVIGATOR.</p>

<h2 class="clause">1. NON-REFUNDABLE CIRCUMSTANCES</h2>
<p>The Client acknowledges and agrees that under no circumstances will NAVIGATOR issue a refund if any of the following situations arise:</p>
<ol class="clauses">
  <li><strong>Changes in Immigration Laws</strong> — If any unexpected, subsequent, or retroactive changes to immigration laws or policies occur after the signing of the Agreement, NAVIGATOR shall not be held liable for refunding any fees paid, as services were rendered in good faith, based on the prevailing laws at the time-of-service provision. If the immigration program in question is closed, or if the maximum capacity for applications is reached, NAVIGATOR will make reasonable efforts to find a suitable alternative.</li>
  <li><strong>Visa Approval Process</strong> — Visa approval is solely at the discretion of the relevant immigration authorities. NAVIGATOR does not guarantee the approval of a visa application. In the event that the visa is rejected by the immigration authorities, NAVIGATOR shall not be responsible for issuing any refunds.</li>
  <li><strong>Ambiguity Between Countries</strong> — If any political or diplomatic issues arise between the country of residence of the Client and the country they are applying to for a ${esc(v.programInterested)}, NAVIGATOR shall not be liable for any refunds.</li>
  <li><strong>Client Withdrawal Before Processing Completion</strong> — If the Client withdraws their application prior to the completion of the processing services, NAVIGATOR shall not be liable for any refund of the fees paid for services already rendered up until the point of withdrawal.</li>
  <li><strong>Inconsistent or Contradictory Information</strong> — Should the Client provide inconsistent, contradictory, or false information during the application process, which causes the Client to become ineligible for immigration after services have been initiated, no refund will be granted.</li>
  <li><strong>Rejection Due to Medical, Criminal, National Security, Financial Issues and Doubt in Intent of travel.</strong> — If the Client&rsquo;s application is rejected on grounds related to medical conditions, criminal records, national security concerns, or financial ineligibility, NAVIGATOR shall not issue any refund.</li>
  <li><strong>Direct Communication with Authorities</strong> — If the Client communicates directly with government bodies, immigration authorities, or any other organizations or agents or employers without the written consent of NAVIGATOR, and such communication results in a negative impact on the application process, NAVIGATOR shall not be liable to provide any refund.</li>
  <li><strong>Provision of False or Fraudulent Information</strong> — If the Client is found to have provided false, misleading, or fraudulent documents or engaged in any form of misrepresentation or fraud, NAVIGATOR shall not issue any refund.</li>
</ol>

${ackBlock()}

<div class="section-break"></div>

<h2 class="clause">2. REFUNDABLE CIRCUMSTANCES</h2>
<p>Refunds will be considered and may be applicable under the following conditions, subject to the terms and conditions set out in this section:</p>
<ol class="clauses">
  <li><strong>Full Package Refund</strong> — Refunds are only applicable if the Client has paid the full package amount as described in Annexure A (Clause 3) of the Agreement. The refund will be processed subject to the stages outlined and the applicable conditions mentioned in this section.</li>
  <li><strong>Failure to Obtain Job Confirmation through email</strong> — If NAVIGATOR or any third-party agent fails to secure a Job Offer Letter (JOL) on behalf of the Client, the Client will be entitled to a 80% refund of the amount paid at the time of sign-up, with 50% retained to cover administrative and legal charges apart from those reasons mentioned in Clause I.</li>
  <li><strong>Failure to Obtain Work Permit After Job Confirmation</strong> — If NAVIGATOR or a third-party agent successfully obtains a job confirmation but is unable to secure the Work Permit apart from those reasons mentioned in Clause I, the Client is entitled to a refund of 50% the amount paid for job confirmation/stage 2.</li>
  <li><strong>Employer Document-Related Refusal and Refund</strong> — In the event that the Client's application is refused solely due to inaccurate, incomplete, or non-compliant documentation provided by the ${esc(employerRegion)} Employer, the Client may be considered eligible for a refund. Any refund shall be subject to the Company's internal assessment, verification of the cause of refusal, and other relevant factors. The final refund amount shall be determined at the sole discretion of the Company based on the findings of such assessment.</li>
  <li><strong>Re-Application / Alternative Work Permit Option</strong> — In the event of a refusal or non-approval for any reason not specifically mentioned or covered under this Agreement, the Company shall, at its discretion, either re-apply for the work permit in the same country or provide the Applicant with an alternative work permit program in another suitable country, in place of the originally opted program.</li>
  <li><strong>Refund Procedure</strong> — Approved refunds will be processed within 90 days after completion of all formalities and management approval. Government fees, VAT, and other statutory charges are non-refundable. The approved refund amount shall be subject to deduction of applicable administrative charges, payment processing fees (2.5%, where applicable), and any other non-recoverable costs incurred by the Company.</li>
</ol>

<p style="margin-top:18px"><strong>IN WITNESS WHEREOF,</strong> the parties hereto have executed this Annexure to the Agreement on the day and year first above written.</p>

<table class="header-fields" style="margin-top:14px">
  <tr><td class="label">For Client:</td><td>Mr./Ms. ${esc(v.signerName || v.clientName)}</td><td style="text-align:right">Yours sincerely</td></tr>
</table>
<div class="sig-line" style="margin-top:18px">Signature: <span class="fill"></span></div>
<div class="sig-line">Name: Mr./Ms. ${esc(v.signerName || v.clientName)}</div>
<div class="sig-line">Date: ${esc(v.signatureDate || v.agreementDate)}</div>
<table class="header-fields">
  <tr><td class="label">Place:</td><td>${esc(v.signaturePlace || 'Dubai, UAE')}</td><td style="text-align:right">For and on the Behalf of<br/>${esc(companyName)}.</td></tr>
</table>

<div class="footer-bar">${esc(companyAddress)} &bull; ${esc(companyPhone)}<br/>${esc(companyEmail)}</div>
</body></html>`;
}
