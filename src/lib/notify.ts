import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from './sequelize';
import { CrmcNotifications } from '@/models';

export async function notifyUser({
  userId,
  type,
  title,
  message,
  priority = 'medium',
  link,
  relatedId,
  relatedType,
}: {
  userId: number | null | undefined;
  type: string;
  title: string;
  message: string;
  priority?: string;
  link?: string | null;
  relatedId?: number | null;
  relatedType?: string | null;
}) {
  if (!userId) return;
  await CrmcNotifications.create({
    user_id: Number(userId),
    type,
    title,
    message,
    priority,
    link: link || null,
    related_id: relatedId ?? null,
    related_type: relatedType ?? null,
  });
}

// Broadcasts to every employee whose crm_role.type matches roleType (e.g.
// 'accountant'), optionally scoped to one branch. Used where the recipient
// is "whoever holds this role" rather than a specific known user.
export async function notifyRole({
  roleType,
  branchId,
  type,
  title,
  message,
  priority = 'medium',
  link,
  relatedId,
  relatedType,
}: {
  roleType: string;
  branchId?: number | null;
  type: string;
  title: string;
  message: string;
  priority?: string;
  link?: string | null;
  relatedId?: number | null;
  relatedType?: string | null;
}) {
  const conditions = ['r.type = :roleType', 'e.status = 1'];
  const replacements: Record<string, unknown> = { roleType };
  if (branchId) {
    conditions.push('e.branch = :branchId');
    replacements.branchId = branchId;
  }

  const employees = await sequelize.query<{ id: number }>(
    `SELECT e.id FROM crm_employee e
     INNER JOIN crm_role r ON r.id = e.role
     WHERE ${conditions.join(' AND ')}`,
    { replacements, type: QueryTypes.SELECT }
  );

  await Promise.all(employees.map((e) => notifyUser({ userId: e.id, type, title, message, priority, link, relatedId, relatedType })));
}

// Notifies the CEO specifically. notifyRole('director') matches crm_role.type,
// which Director / Founder / Super Admin roles share with the CEO, so it can't
// express "the CEO" - the literal role name is the only reliable key (see
// isCeo in roleChecks.ts).
//
// Built for additive call sites next to an existing notification (e.g. the
// Accounts payment-verification alert), so it never throws: a failed alert
// must not turn an already-committed payment into a 500. Skips a user who
// already got the same (type, related record) alert in the last `dedupeSeconds`,
// which covers flows that reach more than one submission endpoint.
export async function notifyCeo({
  type,
  title,
  message,
  priority = 'medium',
  link,
  relatedId,
  relatedType,
  dedupeSeconds = 60,
}: {
  type: string;
  title: string;
  message: string;
  priority?: string;
  link?: string | null;
  relatedId?: number | null;
  relatedType?: string | null;
  dedupeSeconds?: number;
}) {
  try {
    const ceos = await sequelize.query<{ id: number }>(
      `SELECT e.id FROM crm_employee e
       INNER JOIN crm_role r ON r.id = e.role
       WHERE LOWER(TRIM(r.name)) = 'ceo' AND e.status = 1`,
      { type: QueryTypes.SELECT }
    );

    await Promise.all(ceos.map(async (ceo) => {
      if (relatedId != null && dedupeSeconds > 0) {
        const [recent] = await sequelize.query<{ id: number }>(
          `SELECT id FROM crm_notifications
           WHERE user_id = :userId AND type = :type AND related_id = :relatedId AND created_at >= :since
           LIMIT 1`,
          {
            replacements: { userId: ceo.id, type, relatedId, since: new Date(Date.now() - dedupeSeconds * 1000) },
            type: QueryTypes.SELECT,
          }
        );
        if (recent) return;
      }
      await notifyUser({ userId: ceo.id, type, title, message, priority, link, relatedId, relatedType });
    }));
  } catch (error) {
    console.error('notifyCeo failed:', error);
  }
}

// Shared "lead assigned to you" alert. recordLeadAssignment (leadRemarks.ts)
// sends it for every path that funnels through it; the few paths that log their
// own assignment history (e.g. the Edit Lead PUT) call this directly so the new
// owner is still told.
export async function notifyLeadAssigned({
  leadId,
  newAssignTo,
  actorId,
  actorLabel,
  transaction,
}: {
  leadId: number;
  newAssignTo: number | null;
  actorId?: number | null;
  actorLabel?: string | null;
  transaction?: Transaction;
}) {
  if (!newAssignTo || newAssignTo === actorId) return;
  const [leadRow] = await sequelize.query<{ fname: string; lname: string }>(
    'SELECT fname, lname FROM crm_forum_leads WHERE id = :id LIMIT 1',
    { replacements: { id: leadId }, type: QueryTypes.SELECT, transaction }
  );
  const leadName = `${leadRow?.fname || ''} ${leadRow?.lname || ''}`.trim() || `Lead #${leadId}`;
  const byWhom = actorId && actorLabel ? ` by ${actorLabel}` : '';
  await notifyUser({
    userId: newAssignTo,
    type: 'lead_assigned',
    title: 'New lead assigned to you',
    message: `${leadName} has been assigned to you${byWhom}.`,
    priority: 'high',
    relatedId: leadId,
    relatedType: 'lead',
    link: `/admin/leads/${leadId}`,
  });
}
