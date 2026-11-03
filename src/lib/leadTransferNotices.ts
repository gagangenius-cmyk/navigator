import crypto from 'crypto';
import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from './sequelize';
import { sendLeadTransferEmail } from './leadTransferEmail';

/**
 * "Counselor gets an email when a lead is transferred to them."
 *
 * recordLeadAssignment() (the one function every assignment path goes through) calls
 * enqueueTransferNotice() for each lead. Notices are NOT sent one by one: the processor waits a
 * short settle window, then groups everything moved to the same counselor by the same person into
 * ONE email - the full lead details for a single lead, a table of all of them for several.
 * The table doubles as the log: who, which leads, when, the outcome and any error.
 *
 * Runs from the per-minute cron (/api/cron/lead-transfer-emails). Self-migrating table.
 */

let ready: Promise<void> | null = null;
export const ensureTransferNoticeTable = async () => {
  if (!ready) {
    ready = sequelize.query(`
      CREATE TABLE IF NOT EXISTS crm_lead_transfer_notices (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        lead_id INT NOT NULL,
        counselor_id INT NOT NULL,
        from_employee_id INT NULL,
        actor_id INT NULL,
        actor_role VARCHAR(100) NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        batch_token VARCHAR(40) NULL,
        to_email VARCHAR(255) NULL,
        subject VARCHAR(500) NULL,
        batch_size INT NULL,
        message_id VARCHAR(500) NULL,
        last_error VARCHAR(1000) NULL,
        sent_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_transfer_notice_queue (status, next_attempt_at),
        INDEX idx_transfer_notice_lead (lead_id),
        INDEX idx_transfer_notice_counselor (counselor_id, created_at)
      )
    `).then(() => undefined).catch((error) => { ready = null; throw error; });
  }
  await ready;
};

/** Which assignments are a "transfer" worth an email. Pure, so it is unit-tested. */
export function shouldNotifyTransfer(input: { oldAssignTo: number | null; newAssignTo: number | null; actorId: number | null }): boolean {
  if (!input.newAssignTo) return false;                         // unassigned: nobody to tell
  if (input.oldAssignTo === input.newAssignTo) return false;    // nothing changed
  if (input.actorId && input.actorId === input.newAssignTo) return false; // took it for themselves
  // A brand-new lead handed out by the system (web form, Meta, round robin at intake) is not a
  // transfer: it has no previous owner and no person behind it. Everything else is.
  if (input.oldAssignTo === null && !input.actorId) return false;
  return true;
}

export async function enqueueTransferNotice(input: {
  leadId: number; oldAssignTo: number | null; newAssignTo: number | null;
  actorId?: number | null; actorRole?: string | null; transaction?: Transaction;
}): Promise<void> {
  if (!shouldNotifyTransfer({ oldAssignTo: input.oldAssignTo, newAssignTo: input.newAssignTo, actorId: input.actorId ?? null })) return;
  try {
    await ensureTransferNoticeTable();
    await sequelize.query(
      `INSERT INTO crm_lead_transfer_notices (lead_id, counselor_id, from_employee_id, actor_id, actor_role)
       VALUES (:leadId, :counselorId, :fromId, :actorId, :actorRole)`,
      {
        replacements: { leadId: input.leadId, counselorId: input.newAssignTo, fromId: input.oldAssignTo, actorId: input.actorId ?? null, actorRole: input.actorRole ?? null },
        type: QueryTypes.INSERT,
        transaction: input.transaction,
      },
    );
  } catch (error) {
    // A failed notice must never break the transfer itself.
    console.error('[lead-transfer-notice] could not queue notice:', error);
  }
}

// Notices younger than this are left alone so a bulk transfer (one request, many leads) is fully
// queued before it is grouped into a single email.
const SETTLE_SECONDS = () => Math.max(0, Number(process.env.LEAD_TRANSFER_EMAIL_SETTLE_SECONDS) || 20);
const MAX_ATTEMPTS = 3;
const PERMANENT = /^(counselor_not_found|counselor_has_no_email|no_sender|leads_not_found|self_assignment|nothing_to_send)/;

interface NoticeRow { id: number; lead_id: number; counselor_id: number; actor_id: number | null; actor_role: string | null; attempts: number }

export async function processTransferNotices({ maxGroups = 25 }: { maxGroups?: number } = {}) {
  await ensureTransferNoticeTable();
  const result = { emails: 0, leads: 0, skipped: 0, failed: 0 };

  // A crashed run leaves notices in 'sending': hand them back after 10 minutes.
  await sequelize.query(
    "UPDATE crm_lead_transfer_notices SET status = 'pending', batch_token = NULL WHERE status = 'sending' AND next_attempt_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)",
    { type: QueryTypes.UPDATE },
  );

  const due = await sequelize.query<NoticeRow>(
    `SELECT id, lead_id, counselor_id, actor_id, actor_role, attempts FROM crm_lead_transfer_notices
     WHERE status = 'pending' AND next_attempt_at <= NOW() AND created_at <= DATE_SUB(NOW(), INTERVAL :settle SECOND)
     ORDER BY id LIMIT 1000`,
    { replacements: { settle: SETTLE_SECONDS() }, type: QueryTypes.SELECT },
  );

  // One group = one counselor + one person who made the transfer.
  const groups = new Map<string, NoticeRow[]>();
  for (const row of due) {
    const key = `${row.counselor_id}:${row.actor_id ?? 'system'}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const rows of [...groups.values()].slice(0, maxGroups)) {
    const token = crypto.randomUUID();
    const ids = rows.map((r) => r.id);
    const [, claimed] = await sequelize.query(
      "UPDATE crm_lead_transfer_notices SET status = 'sending', batch_token = :token, attempts = attempts + 1, next_attempt_at = NOW() WHERE id IN (:ids) AND status = 'pending'",
      { replacements: { token, ids }, type: QueryTypes.UPDATE },
    );
    if (Number((claimed as { affectedRows?: number })?.affectedRows ?? claimed ?? 0) < 1) continue;

    const { counselor_id: counselorId, actor_id: actorId, actor_role: actorRole } = rows[0];

    // Only leads the counselor still owns: if it was moved on again before the email went out,
    // telling them about it would be wrong.
    const owned = await sequelize.query<{ id: number }>(
      'SELECT id FROM crm_forum_leads WHERE id IN (:leadIds) AND (assignTo = :counselorId OR Counsilor = :counselorId)',
      { replacements: { leadIds: rows.map((r) => r.lead_id), counselorId }, type: QueryTypes.SELECT },
    );
    const ownedIds = [...new Set(owned.map((o) => Number(o.id)))];
    const stale = rows.filter((r) => !ownedIds.includes(Number(r.lead_id))).map((r) => r.id);
    if (stale.length) {
      await sequelize.query("UPDATE crm_lead_transfer_notices SET status = 'skipped', last_error = 'lead_moved_again' WHERE id IN (:stale)", { replacements: { stale }, type: QueryTypes.UPDATE });
      result.skipped += stale.length;
    }
    const live = rows.filter((r) => ownedIds.includes(Number(r.lead_id)));
    if (!live.length) continue;

    const outcome = await sendLeadTransferEmail({
      counselorId,
      leadIds: live.map((r) => r.lead_id),
      actor: actorId ? { id: actorId, roleName: actorRole } : null,
    });

    const liveIds = live.map((r) => r.id);
    if (outcome.sent) {
      await sequelize.query(
        "UPDATE crm_lead_transfer_notices SET status = 'sent', sent_at = NOW(), to_email = :to, subject = :subject, batch_size = :size, message_id = :messageId, last_error = NULL WHERE id IN (:ids)",
        { replacements: { ids: liveIds, to: outcome.to ?? null, subject: (outcome.subject ?? '').slice(0, 490), size: live.length, messageId: (outcome.messageId ?? '').slice(0, 490) || null }, type: QueryTypes.UPDATE },
      );
      result.emails += 1; result.leads += live.length;
      continue;
    }

    const reason = (outcome.reason || 'unknown').slice(0, 990);
    const final = PERMANENT.test(reason) || Math.max(...live.map((r) => r.attempts)) + 1 >= MAX_ATTEMPTS;
    await sequelize.query(
      `UPDATE crm_lead_transfer_notices SET status = :status, last_error = :reason, to_email = :to, batch_token = NULL,
         next_attempt_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id IN (:ids)`,
      { replacements: { ids: liveIds, status: final ? (PERMANENT.test(reason) ? 'skipped' : 'failed') : 'pending', reason, to: outcome.to ?? null }, type: QueryTypes.UPDATE },
    );
    if (final) result.failed += live.length;
  }
  return result;
}
