import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';

// No SMS provider is integrated in this codebase yet (confirmed by audit -
// see docs/broadcast-architecture.md open decision #2: no Twilio or
// equivalent anywhere in src/). This mirrors src/lib/mailer.ts and
// src/lib/whatsapp.ts's exact shape (same delivery-log table pattern, same
// "throw a descriptive error per-send, caller catches/logs" contract) so
// that once a provider is chosen, only this file's fetch() call needs to
// change - every caller (the Phase 3 broadcast worker, any future
// transactional SMS call site) already codes against this signature.
//
// Deliberately does NOT fabricate a working integration: calling this with
// no SMS_PROVIDER configured throws immediately, same as mailer.ts/
// whatsapp.ts do today when their real credentials are unset.

let deliveryLogTableReady: Promise<void> | null = null;

const ensureDeliveryLogTable = async () => {
  if (!deliveryLogTableReady) {
    deliveryLogTableReady = sequelize.query(`
      CREATE TABLE IF NOT EXISTS crm_sms_delivery_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        recipient VARCHAR(30) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL,
        provider_message_id VARCHAR(255) NULL,
        error TEXT NULL,
        actor_id INT NULL,
        lead_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sms_delivery_status (status),
        INDEX idx_sms_delivery_recipient (recipient),
        INDEX idx_sms_delivery_lead (lead_id),
        INDEX idx_sms_delivery_created (created_at)
      )
    `).then(() => undefined).catch((error) => {
      deliveryLogTableReady = null;
      throw error;
    });
  }
  await deliveryLogTableReady;
};

async function recordDelivery(input: {
  recipient: string;
  message: string;
  status: 'sent' | 'failed';
  providerMessageId?: string | null;
  error?: string | null;
  actorId?: number | null;
  leadId?: number | null;
}) {
  try {
    await ensureDeliveryLogTable();
    await sequelize.query(
      `INSERT INTO crm_sms_delivery_log (recipient, message, status, provider_message_id, error, actor_id, lead_id)
       VALUES (:recipient, :message, :status, :providerMessageId, :error, :actorId, :leadId)`,
      {
        replacements: {
          recipient: input.recipient,
          message: input.message,
          status: input.status,
          providerMessageId: input.providerMessageId ?? null,
          error: input.error ?? null,
          actorId: input.actorId ?? null,
          leadId: input.leadId ?? null,
        },
      }
    );
  } catch (error) {
    console.error('Failed to record SMS delivery log entry:', error);
  }
}

export function isSmsProviderConfigured(): boolean {
  return Boolean(process.env.SMS_PROVIDER && process.env.SMS_API_KEY);
}

export async function sendSmsMessage({ to, message, actorId, leadId }: {
  to: string;
  message: string;
  actorId?: number | null;
  leadId?: number | null;
}) {
  const digits = to.replace(/\D/g, '');

  if (!digits) {
    const error = 'No valid phone number to send to';
    void recordDelivery({ recipient: to, message, status: 'failed', error, actorId, leadId });
    throw new Error(error);
  }

  if (!isSmsProviderConfigured()) {
    const error = 'No SMS provider is configured (SMS_PROVIDER / SMS_API_KEY) - see docs/broadcast-architecture.md open decision #2';
    void recordDelivery({ recipient: digits, message, status: 'failed', error, actorId, leadId });
    throw new Error(error);
  }

  // No provider is wired up to call here yet - this branch is unreachable
  // until isSmsProviderConfigured() can be true, which happens only once a
  // real provider integration replaces this comment with an actual fetch()
  // call (matching mailer.ts's Resend call / whatsapp.ts's Graph API call).
  throw new Error('SMS provider integration not implemented yet');
}

export interface SmsDeliveryLogEntry {
  id: number;
  recipient: string;
  message: string;
  status: 'sent' | 'failed';
  providerMessageId: string | null;
  error: string | null;
  actorId: number | null;
  leadId: number | null;
  createdAt: string;
}

export async function listSmsDeliveryLog({
  status,
  leadId,
  limit = 100,
}: { status?: 'sent' | 'failed'; leadId?: number; limit?: number } = {}): Promise<SmsDeliveryLogEntry[]> {
  await ensureDeliveryLogTable();
  const conditions: string[] = [];
  const replacements: Record<string, unknown> = { limit };
  if (status) {
    conditions.push('status = :status');
    replacements.status = status;
  }
  if (leadId) {
    conditions.push('lead_id = :leadId');
    replacements.leadId = leadId;
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await sequelize.query<{
    id: number; recipient: string; message: string; status: 'sent' | 'failed';
    provider_message_id: string | null; error: string | null; actor_id: number | null;
    lead_id: number | null; created_at: string;
  }>(
    `SELECT * FROM crm_sms_delivery_log ${whereSql} ORDER BY created_at DESC LIMIT :limit`,
    { replacements, type: QueryTypes.SELECT }
  );
  return rows.map((r) => ({
    id: r.id,
    recipient: r.recipient,
    message: r.message,
    status: r.status,
    providerMessageId: r.provider_message_id,
    error: r.error,
    actorId: r.actor_id,
    leadId: r.lead_id,
    createdAt: r.created_at,
  }));
}
