import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import { deactivateMobileDevices, getActiveMobileDevices, type MobileDevice } from './mobileDevices';
import { sendAndroidPush, sendIosPush, type SendOutcome } from './mobilePushTransport';
import {
  EMPTY_FACTS,
  buildPushPayload,
  cleanFacts,
  isPushEligible,
  type PushFacts,
  type PushPayload,
  type PushSource,
  type PushType,
} from './mobilePushContent';

// Turns a crm_notifications row into a native push for the mobile app.
// Called from the CrmcNotifications afterCreate hook, so every notifyUser /
// notifyRole path is covered without touching the call sites. Which types are
// pushed, and what they say, is in mobilePushContent.ts; delivery to FCM/APNs
// is in mobilePushTransport.ts.

export { isPushEligible };
export type { PushSource };

// ---------- facts (one query per type, keyed by lead id) ----------------

const fullName = (first?: string | null, last?: string | null) => `${first || ''} ${last || ''}`.trim();

export async function loadPushFacts(type: PushType, leadId: number | null): Promise<PushFacts> {
  if (!leadId) return EMPTY_FACTS;
  const replacements = { leadId };

  try {
    switch (type) {
      case 'lead_assigned': {
        const [lead] = await sequelize.query<{ fname: string; lname: string; phone: string | null; source: string | null }>(
          `SELECT l.fname, l.lname, COALESCE(NULLIF(l.mobile, ''), l.phone) AS phone, src.name AS source
           FROM crm_forum_leads l
           LEFT JOIN crm_source src ON src.id = l.market_source
           WHERE l.id = :leadId LIMIT 1`,
          { replacements, type: QueryTypes.SELECT },
        );
        if (!lead) return EMPTY_FACTS;
        return {
          ids: cleanFacts({ leadId }),
          display: cleanFacts({ leadName: fullName(lead.fname, lead.lname), phone: lead.phone, source: lead.source }),
        };
      }

      case 'discount_requested': {
        const [row] = await sequelize.query<{
          id: number; discountType: string | null; discountAmount: number | string; originalAmount: number | string;
          currency: string | null; requestedBy: string | null; fname: string; lname: string;
        }>(
          `SELECT da.id, da.discountType, da.discountAmount, da.originalAmount, da.currency,
                  e.name AS requestedBy, l.fname, l.lname
           FROM crm_discount_approvals da
           LEFT JOIN crm_employee e ON e.id = da.requestedBy
           LEFT JOIN crm_forum_leads l ON l.id = da.leadId
           WHERE da.leadId = :leadId AND da.status = 'pending' AND da.is_deleted = 0
           ORDER BY da.id DESC LIMIT 1`,
          { replacements, type: QueryTypes.SELECT },
        );
        if (!row) return { ids: cleanFacts({ leadId }), display: {} };
        const amount = Number(row.discountAmount) || 0;
        const original = Number(row.originalAmount) || 0;
        return {
          ids: cleanFacts({ leadId, discountApprovalId: row.id }),
          display: cleanFacts({
            clientName: fullName(row.fname, row.lname),
            discountAmount: amount,
            discountPercent: original > 0 ? Math.round((amount / original) * 1000) / 10 : null,
            currency: row.currency,
            discountType: row.discountType,
            requestedBy: row.requestedBy,
          }),
        };
      }

      case 'payment_submission': {
        const [row] = await sequelize.query<{
          id: string | number; paymentNumber: string | null; paidAmount: number | string | null;
          currency: string | null; fname: string; lname: string;
        }>(
          `SELECT p.id, p.paymentNumber, p.paidAmount, COALESCE(p.currency, 'AED') AS currency, l.fname, l.lname
           FROM crm_opportunity_payments p
           INNER JOIN crm_opportunities o ON o.id = p.opportunityId
           LEFT JOIN crm_forum_leads l ON l.id = o.leadId
           WHERE o.leadId = :leadId
             AND COALESCE(o.is_deleted, 0) = 0
             AND COALESCE(p.accountantStatus, 'pending') = 'pending'
           ORDER BY p.createdAt DESC LIMIT 1`,
          { replacements, type: QueryTypes.SELECT },
        );
        if (!row) return { ids: cleanFacts({ leadId }), display: {} };
        return {
          ids: cleanFacts({ leadId, paymentId: row.id }),
          display: cleanFacts({
            clientName: fullName(row.fname, row.lname),
            amount: row.paidAmount,
            currency: row.currency,
            receiptNumber: row.paymentNumber,
          }),
        };
      }

      case 'compliance_submission': {
        const [row] = await sequelize.query<{ id: number; submittedBy: string | null; fname: string; lname: string }>(
          `SELECT ca.id, e.name AS submittedBy, l.fname, l.lname
           FROM crm_opportunity_compliance_approvals ca
           LEFT JOIN crm_employee e ON e.id = ca.submittedBy
           LEFT JOIN crm_forum_leads l ON l.id = ca.leadId
           WHERE ca.leadId = :leadId AND ca.status IN ('pending', 'under_review')
           ORDER BY ca.id DESC LIMIT 1`,
          { replacements, type: QueryTypes.SELECT },
        );
        if (!row) return { ids: cleanFacts({ leadId }), display: {} };
        return {
          ids: cleanFacts({ leadId, complianceApprovalId: row.id }),
          display: cleanFacts({ clientName: fullName(row.fname, row.lname), submittedBy: row.submittedBy }),
        };
      }
    }
  } catch (error) {
    console.error(`Failed to load push facts for ${type}:`, error);
    return { ids: cleanFacts({ leadId }), display: {} };
  }
}

async function unreadCount(userId: number): Promise<number | null> {
  try {
    const [row] = await sequelize.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM crm_notifications WHERE user_id = :userId AND is_read = 0`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return Number(row?.total ?? 0);
  } catch {
    return null;
  }
}

// ---------- entry point -------------------------------------------------

const send = (device: MobileDevice, payload: PushPayload): Promise<SendOutcome> =>
  device.platform === 'ios' ? sendIosPush(device, payload) : sendAndroidPush(device, payload);

/** Never throws - a push failure must not affect the notification that triggered it. */
export async function sendMobilePush(source: PushSource): Promise<void> {
  try {
    if (process.env.MOBILE_PUSH_ENABLED === 'false') return;
    if (!isPushEligible(source.type)) return;

    const devices = await getActiveMobileDevices(source.user_id);
    if (!devices.length) return;

    // Secure by default: redact unless explicitly turned off. Push content is an
    // OS-level surface (iOS renders it straight to the lock screen) that isn't
    // gated by the app's own auth/biometric lock, so an unset env var must not
    // mean "show client names, phone numbers and amounts to anyone near the phone".
    const redact = process.env.MOBILE_PUSH_REDACT !== 'false';
    // All four push types are keyed by the lead; related_type is 'lead' for each.
    const leadId = source.related_type === 'lead' ? source.related_id : null;
    const [facts, badge] = await Promise.all([loadPushFacts(source.type, leadId), unreadCount(source.user_id)]);
    const payload = buildPushPayload(source, source.type, facts, { redact, badge });

    const outcomes = await Promise.all(devices.map((device) => send(device, payload)));

    const dead = outcomes.filter((o) => o.unregistered).map((o) => o.token);
    if (dead.length) await deactivateMobileDevices(dead);

    const failed = outcomes.filter((o) => !o.ok && !o.skipped && !o.unregistered);
    if (failed.length) {
      console.error(`Mobile push: ${failed.length}/${outcomes.length} deliveries failed for notification ${source.id}:`, failed.map((f) => f.error));
    }
  } catch (error) {
    console.error('Mobile push failed:', error);
  }
}
