import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import type { User } from '@/lib/auth';
import { isBranchManagerOrCeo, canViewAllBranches, getRecordVisibilityScope } from '@/lib/roleChecks';
import { isCrossBranchWorkRole } from '@/lib/leadAccess';
import { suppressionAddressHash } from '@/lib/broadcastDedupeKeys';
import { ensureMailboxTables } from '@/lib/mailboxes';

export type SenderMode = 'me' | 'owner';

export const MAX_LEADS_PER_SEND = 500;
// Per user, per rolling hour, counted in emails: one-at-a-time sends are normal use,
// a runaway bulk send is what this stops.
export const MAX_EMAILS_PER_HOUR = 200;

export const SKIP_REASON_LABELS: Record<string, string> = {
  not_found: 'Lead not found',
  no_access: "You can't access this lead",
  no_email: 'No email address',
  invalid_email: 'Invalid email address',
  duplicate_in_selection: 'Same email already in this send',
  suppressed: 'Unsubscribed / bounced',
  opted_out: 'Opted out of email',
  lead_status_excluded: 'Lead status excluded (e.g. DNQ, Not Interested)',
  no_owner: 'Lead has no counsellor',
  sender_inactive: 'Sender account is inactive',
  no_mailbox: "Sender has no email mailbox connected (Admin → Mailboxes)",
};

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const excludedStatuses = () => String(process.env.TEMPLATE_SEND_EXCLUDED_STATUSES || 'DNQ,Not Interested')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Managers may send as each lead's counsellor; everyone else always sends as themselves. */
export const canSendAsOwner = (user: User) => isBranchManagerOrCeo(user) || canViewAllBranches(user);

export interface Recipient {
  leadId: number;
  leadName: string;
  toEmail: string | null;
  senderEmployeeId: number | null;
  senderName: string | null;
  mailboxId: number | null;
  senderEmail: string | null;
  skipReason: string | null;
}

interface LeadRow {
  id: number; fname: string | null; lname: string | null; email: string | null; status: string | null;
  branch: number | null; region: number | null; assignTo: number | null; Counsilor: number | null; ownerId: number | null;
}

/** The batch counterpart of assertLeadAccess (lib/leadAccess.ts): same branch / region / own scoping. */
function canAccess(user: User, lead: LeadRow, myOpportunityLeadIds: Set<number>): boolean {
  const scope = getRecordVisibilityScope(user);
  if (scope === 'all' || isCrossBranchWorkRole(user)) return true;
  if (scope === 'branch') return Number(lead.branch) === Number(user.branch);
  if (scope === 'region') return Number(lead.region) === Number(user.region);
  return Number(lead.Counsilor) === Number(user.id) || Number(lead.assignTo) === Number(user.id) || myOpportunityLeadIds.has(Number(lead.id));
}

/**
 * Applies every skip rule to the selected leads. Shared by the dry-run preview and by job
 * creation, so "X will send, Y skipped" is exactly what gets queued.
 */
export async function resolveRecipients(user: User, leadIds: number[], requestedMode: SenderMode): Promise<Recipient[]> {
  const ids = [...new Set(leadIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return [];
  const mode: SenderMode = canSendAsOwner(user) ? requestedMode : 'me';
  await ensureMailboxTables();

  const leads = await sequelize.query<LeadRow>(
    `SELECT id, fname, lname, email, status, branch, region, assignTo, Counsilor,
            COALESCE(NULLIF(Counsilor, 0), NULLIF(assignTo, 0)) AS ownerId
     FROM crm_forum_leads WHERE id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  const byId = new Map(leads.map((l) => [Number(l.id), l]));

  const myOpportunityLeadIds = new Set<number>();
  if (getRecordVisibilityScope(user) === 'own') {
    const rows = await sequelize.query<{ leadId: number }>(
      'SELECT DISTINCT leadId FROM crm_opportunities WHERE leadId IN (:ids) AND is_deleted = 0 AND (assignedTo = :uid OR createdBy = :uid)',
      { replacements: { ids, uid: user.id }, type: QueryTypes.SELECT },
    );
    rows.forEach((r) => myOpportunityLeadIds.add(Number(r.leadId)));
  }

  const senderIds = new Set<number>([Number(user.id)]);
  if (mode === 'owner') leads.forEach((l) => { if (Number(l.ownerId)) senderIds.add(Number(l.ownerId)); });
  const senderIdList = [...senderIds];
  const employees = await sequelize.query<{ id: number; name: string; status: number }>(
    'SELECT id, name, status FROM crm_employee WHERE id IN (:ids)',
    { replacements: { ids: senderIdList }, type: QueryTypes.SELECT },
  );
  const employeeById = new Map(employees.map((e) => [Number(e.id), e]));
  const mailboxes = await sequelize.query<{ id: number; employee_id: number; email: string }>(
    'SELECT id, employee_id, email FROM crm_employee_mailboxes WHERE employee_id IN (:ids) AND is_active = 1',
    { replacements: { ids: senderIdList }, type: QueryTypes.SELECT },
  );
  const mailboxByEmployee = new Map(mailboxes.map((m) => [Number(m.employee_id), m]));

  const emails = leads.map((l) => String(l.email || '').trim().toLowerCase()).filter((e) => EMAIL.test(e));
  const suppressedHashes = new Set(emails.length
    ? (await sequelize.query<{ address_hash: string }>(
      "SELECT address_hash FROM crm_message_suppressions WHERE channel = 'email' AND address_hash IN (:hashes)",
      { replacements: { hashes: emails.map(suppressionAddressHash) }, type: QueryTypes.SELECT },
    )).map((r) => r.address_hash)
    : []);
  const optedOut = new Set((await sequelize.query<{ lead_id: number }>(
    "SELECT lead_id FROM crm_contact_channel_consents WHERE channel = 'email' AND consent_state = 'opted_out' AND lead_id IN (:ids)",
    { replacements: { ids }, type: QueryTypes.SELECT },
  )).map((r) => Number(r.lead_id)));

  const seen = new Set<string>();
  const excluded = excludedStatuses();
  return ids.map((leadId): Recipient => {
    const lead = byId.get(leadId);
    const base: Recipient = {
      leadId,
      leadName: lead ? [lead.fname, lead.lname].filter(Boolean).join(' ').trim() || `Lead #${leadId}` : `Lead #${leadId}`,
      toEmail: null, senderEmployeeId: null, senderName: null, mailboxId: null, senderEmail: null, skipReason: null,
    };
    if (!lead) return { ...base, skipReason: 'not_found' };
    if (!canAccess(user, lead, myOpportunityLeadIds)) return { ...base, skipReason: 'no_access' };

    const senderId = mode === 'owner' ? Number(lead.ownerId) || null : Number(user.id);
    const sender = senderId ? employeeById.get(senderId) : undefined;
    const mailbox = senderId ? mailboxByEmployee.get(senderId) : undefined;
    const withSender: Recipient = {
      ...base, senderEmployeeId: senderId, senderName: sender?.name || null,
      mailboxId: mailbox ? Number(mailbox.id) : null, senderEmail: mailbox?.email || null,
    };

    const email = String(lead.email || '').trim().toLowerCase();
    const result: Recipient = { ...withSender, toEmail: email || null };
    if (!email) return { ...result, skipReason: 'no_email' };
    if (!EMAIL.test(email)) return { ...result, skipReason: 'invalid_email' };
    if (suppressedHashes.has(suppressionAddressHash(email))) return { ...result, skipReason: 'suppressed' };
    if (optedOut.has(leadId)) return { ...result, skipReason: 'opted_out' };
    if (excluded.includes(String(lead.status || '').trim().toLowerCase())) return { ...result, skipReason: 'lead_status_excluded' };
    if (!senderId) return { ...result, skipReason: 'no_owner' };
    if (!sender || Number(sender.status) !== 1) return { ...result, skipReason: 'sender_inactive' };
    if (!mailbox) return { ...result, skipReason: 'no_mailbox' };
    if (seen.has(email)) return { ...result, skipReason: 'duplicate_in_selection' };
    seen.add(email);
    return { ...result, skipReason: null };
  });
}

export function summarize(recipients: Recipient[]) {
  const skipped: Record<string, number> = {};
  const perSender: Record<string, { name: string; email: string; count: number }> = {};
  for (const r of recipients) {
    if (r.skipReason) { skipped[r.skipReason] = (skipped[r.skipReason] || 0) + 1; continue; }
    const key = r.senderEmail || '';
    perSender[key] ||= { name: r.senderName || key, email: key, count: 0 };
    perSender[key].count++;
  }
  const willSend = recipients.filter((r) => !r.skipReason).length;
  return {
    willSend,
    skippedTotal: recipients.length - willSend,
    skipped: Object.entries(skipped).map(([reason, count]) => ({ reason, label: SKIP_REASON_LABELS[reason] || reason, count })),
    perSender: Object.values(perSender),
  };
}
