import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { sendEmail } from '@/lib/mailer';
import { getMailboxForEmployee, sendFromMailbox } from '@/lib/mailboxes';
import { htmlToText } from '@/lib/templateSend/render';

// Gmail clips any message whose HTML passes ~100KB, and a "select all" transfer
// can span thousands of leads. Past this many the email lists the first ones
// and points the counselor at the CRM for the rest.
export const MAX_LEADS_IN_TRANSFER_EMAIL = 100;

type TransferActor = { id: number; roleName?: string | null; type?: string | null };

type TransferLead = {
  id: number;
  name: string;
  phone: string;
  email: string;
  nationality: string;
  branch: string;
  serviceInterest: string;
  countryInterest: string;
  marketSource: string;
  campaign: string;
  priority: string;
  status: string;
  leadQuality: string;
  enquiry: string;
  notes: string;
  followUp: string;
  created: string;
};

type LeadRow = {
  id: number; fname: string | null; mname: string | null; lname: string | null; email: string | null;
  phone: string | null; mobile: string | null; nationality: string | null; campaign: string | null;
  priority: string | null; status: string | null; lead_quality: string | null; enquiry: string | null;
  lead_remark: string | null; followup: string | null; folowuptime: string | null; created: string | null;
  serviceName: string | null; serviceRaw: string | null; countryName: string | null; countryRaw: string | null;
  sourceName: string | null; sourceRaw: string | null; branchName: string | null;
};

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Lead fields come straight from public web forms and Meta ads, so nothing
// from them may reach the email as markup.
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
const oneLine = (value: string) => value.replace(/[\r\n\t]+/g, ' ').trim();
// service/country/source are varchar columns holding a dm_* id; a value with no
// matching row is only worth showing when it is real text rather than a dead id.
const label = (name: string | null, raw: string | null) => name || (raw && !/^\d+$/.test(raw.trim()) ? raw : '') || '';
const blankDate = (value: string | null) => (!value || value.startsWith('0000') ? '' : value);

function toTransferLead(row: LeadRow): TransferLead {
  const followUpDate = blankDate(row.followup);
  return {
    id: row.id,
    name: [row.fname, row.mname, row.lname].map((part) => (part || '').trim()).filter(Boolean).join(' ') || `Lead #${row.id}`,
    phone: (row.phone || row.mobile || '').trim(),
    email: (row.email || '').trim(),
    nationality: (row.nationality || '').trim(),
    branch: row.branchName || '',
    serviceInterest: label(row.serviceName, row.serviceRaw),
    countryInterest: label(row.countryName, row.countryRaw),
    marketSource: label(row.sourceName, row.sourceRaw),
    campaign: (row.campaign || '').trim(),
    priority: (row.priority || '').trim(),
    status: (row.status || '').trim(),
    leadQuality: (row.lead_quality || '').trim(),
    enquiry: (row.enquiry || '').trim(),
    notes: (row.lead_remark || '').trim().slice(0, 800),
    followUp: followUpDate ? `${followUpDate}${row.folowuptime ? ` ${String(row.folowuptime).slice(0, 5)}` : ''}` : '',
    created: (row.created || '').slice(0, 16),
  };
}

const STYLES = `
  body{margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937}
  .wrap{max-width:720px;margin:0 auto;padding:24px 12px}
  .card{background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}
  .head{background:#1d4ed8;color:#ffffff;padding:18px 24px}
  .head h1{margin:0;font-size:18px;font-weight:700}
  .body{padding:22px 24px;font-size:14px;line-height:1.55}
  .body p{margin:0 0 14px}
  table.kv{width:100%;border-collapse:collapse;margin:6px 0 18px}
  table.kv th{width:34%;text-align:left;vertical-align:top;padding:9px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-size:13px;color:#4b5563}
  table.kv td{padding:9px 12px;border:1px solid #e5e7eb;font-size:14px}
  .scroll{overflow-x:auto}
  table.grid{width:100%;border-collapse:collapse;margin:6px 0 18px;font-size:12px}
  table.grid th{text-align:left;padding:8px 9px;background:#f9fafb;border:1px solid #e5e7eb;color:#4b5563;white-space:nowrap}
  table.grid td{padding:8px 9px;border:1px solid #e5e7eb;vertical-align:top}
  .btn{display:inline-block;background:#1d4ed8;color:#ffffff !important;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600}
  .note{margin:0 0 14px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:13px;color:#92400e}
  .foot{padding:14px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#6b7280}
`;

export function buildLeadTransferEmail({ counselorName, actorName, actorRole, leads, totalLeads, appUrl }: {
  counselorName: string;
  actorName: string;
  actorRole: string;
  leads: TransferLead[];
  // How many leads were transferred in total, which can exceed leads.length when capped.
  totalLeads: number;
  appUrl: string;
}): { subject: string; html: string } {
  const base = appUrl.replace(/\/+$/, '');
  const leadUrl = (id: number) => (base ? `${base}/admin/leads/${id}/edit` : '');
  const single = totalLeads === 1 && leads.length === 1;

  const subject = single
    ? `Lead assigned to you: ${oneLine(leads[0].name)} (#${leads[0].id})`
    : `${totalLeads} leads assigned to you`;

  const intro = `<p>Hi ${esc(counselorName)},</p>
    <p>${esc(actorName)} (${esc(actorRole)}) has assigned ${single ? '<strong>1 lead</strong>' : `<strong>${totalLeads} leads</strong>`} to you. ${single ? 'Here are the details' : 'Here are the details of each'}:</p>`;

  const row = (heading: string, value: string) => value ? `<tr><th>${heading}</th><td>${esc(value)}</td></tr>` : '';
  let details: string;
  if (single) {
    const lead = leads[0];
    details = `<table class="kv">
      ${row('Lead ID', `#${lead.id}`)}
      ${row('Name', lead.name)}
      ${row('Phone', lead.phone)}
      ${row('Email', lead.email)}
      ${row('Nationality', lead.nationality)}
      ${row('Branch', lead.branch)}
      ${row('Service interest', lead.serviceInterest)}
      ${row('Destination country', lead.countryInterest)}
      ${row('Lead source', lead.marketSource)}
      ${row('Campaign', lead.campaign)}
      ${row('Priority', lead.priority)}
      ${row('Status', lead.status)}
      ${row('Lead quality', lead.leadQuality)}
      ${row('Enquiry', lead.enquiry)}
      ${row('Follow-up', lead.followUp)}
      ${row('Created', lead.created)}
      ${lead.notes ? `<tr><th>Notes</th><td>${esc(lead.notes).replace(/\r?\n/g, '<br>')}</td></tr>` : ''}
    </table>`;
  } else {
    const cell = (value: string) => `<td>${esc(value) || '&mdash;'}</td>`;
    const rows = leads.map((lead) => {
      const url = leadUrl(lead.id);
      const idCell = url ? `<td><a href="${esc(url)}">#${lead.id}</a></td>` : `<td>#${lead.id}</td>`;
      return `<tr>${idCell}${cell(lead.name)}${cell(lead.phone)}${cell(lead.email)}${cell(lead.nationality)}${cell(lead.serviceInterest)}${cell(lead.countryInterest)}${cell(lead.marketSource)}${cell(lead.campaign)}${cell(lead.priority)}${cell(lead.status)}${cell(lead.created)}</tr>`;
    }).join('');
    details = `${totalLeads > leads.length
      ? `<div class="note">Showing the first ${leads.length} of ${totalLeads} transferred leads. Open the CRM to see the rest.</div>` : ''}
      <div class="scroll"><table class="grid">
        <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Email</th><th>Nationality</th><th>Service</th><th>Destination</th><th>Source</th><th>Campaign</th><th>Priority</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  const cta = single ? leadUrl(leads[0].id) : (base ? `${base}/admin/leads` : '');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLES}</style></head>
<body><div class="wrap"><div class="card">
  <div class="head"><h1>${single ? 'New lead assigned to you' : `${totalLeads} new leads assigned to you`}</h1></div>
  <div class="body">${intro}${details}${cta ? `<p><a class="btn" href="${esc(cta)}">${single ? 'Open lead in CRM' : 'Open my leads in CRM'}</a></p>` : ''}</div>
  <div class="foot">This is an automated notification from the CRM. Please do not reply to this email.</div>
</div></div></body></html>`;

  return { subject, html };
}

export type TransferEmailResult = { sent: boolean; reason?: string; messageId?: string; to?: string; subject?: string; leadCount?: number };

/**
 * Builds and sends ONE email telling a counselor which leads were transferred to them (full detail
 * for a single lead, a table for several). Used by the transfer-notice queue
 * (leadTransferNotices.ts), which batches every lead moved to the same counselor in the same
 * action into one call. Never throws: the outcome is returned so the queue can record it.
 *
 * Transport: the system sender (Resend) when configured, else the person who made the transfer
 * sends it from their own connected SMTP mailbox.
 */
export async function sendLeadTransferEmail({ counselorId, leadIds, actor }: {
  counselorId: number;
  leadIds: number[];
  actor: TransferActor | null;
}): Promise<TransferEmailResult> {
  const ids = Array.from(new Set(leadIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))).sort((a, b) => a - b);
  if (!counselorId || ids.length === 0) return { sent: false, reason: 'nothing_to_send' };
  if (actor && counselorId === actor.id) return { sent: false, reason: 'self_assignment' };

  const [counselor] = await sequelize.query<{ id: number; name: string; email: string | null; cemail: string | null }>(
    'SELECT id, name, email, cemail FROM crm_employee WHERE id = :counselorId AND status = 1 LIMIT 1',
    { replacements: { counselorId }, type: QueryTypes.SELECT },
  );
  if (!counselor) return { sent: false, reason: 'counselor_not_found (missing or inactive)' };

  // Company address first, personal second (same precedence the HR emails use).
  const to = [counselor.cemail, counselor.email].map((value) => (value || '').trim()).find((value) => value.includes('@'));
  if (!to) return { sent: false, reason: `counselor_has_no_email (${counselor.name})` };

  const rows = await sequelize.query<LeadRow>(
    `SELECT l.id, l.fname, l.mname, l.lname, l.email, l.phone, l.mobile, l.nationality, l.campaign, l.priority,
            l.status, l.lead_quality, l.enquiry, l.lead_remark,
            CAST(l.followup AS CHAR) AS followup, CAST(l.folowuptime AS CHAR) AS folowuptime, CAST(l.created AS CHAR) AS created,
            sv.name AS serviceName, l.service_interest AS serviceRaw,
            ci.name AS countryName, l.country_interest AS countryRaw,
            ms.name AS sourceName, l.market_source AS sourceRaw,
            b.branch AS branchName
     FROM crm_forum_leads l
     LEFT JOIN crm_service sv ON sv.id = l.service_interest
     LEFT JOIN crm_country_proces ci ON ci.id = l.country_interest
     LEFT JOIN crm_source ms ON ms.id = l.market_source
     LEFT JOIN crm_branch b ON b.id = l.branch
     WHERE l.id IN (:ids)
     ORDER BY l.id ASC
     LIMIT :maxLeads`,
    { replacements: { ids, maxLeads: MAX_LEADS_IN_TRANSFER_EMAIL }, type: QueryTypes.SELECT },
  );
  if (rows.length === 0) return { sent: false, reason: 'leads_not_found' };

  let actorName = 'The CRM';
  if (actor) {
    const [actorRow] = await sequelize.query<{ name: string }>('SELECT name FROM crm_employee WHERE id = :id LIMIT 1', { replacements: { id: actor.id }, type: QueryTypes.SELECT });
    actorName = actorRow?.name || `Employee #${actor.id}`;
  }

  const built = buildLeadTransferEmail({
    counselorName: counselor.name,
    actorName,
    actorRole: actor ? (actor.roleName || actor.type || 'Team') : 'automatic assignment',
    leads: rows.map(toTransferLead),
    totalLeads: Math.max(ids.length, rows.length),
    appUrl: process.env.NEXT_PUBLIC_APP_URL || '',
  });
  const base = { to, subject: built.subject, leadCount: ids.length };

  try {
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      const result = await sendEmail({ to, subject: built.subject, html: built.html });
      return { sent: true, messageId: (result as { id?: string })?.id, ...base };
    }
    // No system sender configured: send from the transferring employee's own SMTP mailbox.
    const mailbox = actor ? await getMailboxForEmployee(actor.id) : null;
    if (!mailbox || !mailbox.is_active) {
      return { sent: false, reason: 'no_sender: configure RESEND_API_KEY/RESEND_FROM_EMAIL, or connect a mailbox for the person transferring', ...base };
    }
    const text = htmlToText(built.html);
    const result = await sendFromMailbox(mailbox, { to, subject: built.subject, body: text, html: built.html });
    return { sent: true, messageId: result.messageId, ...base };
  } catch (error) {
    return { sent: false, reason: `send_failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}`, ...base };
  }
}
