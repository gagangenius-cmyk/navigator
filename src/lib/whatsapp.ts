import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';

// Thin wrapper over Meta's WhatsApp Cloud API via plain `fetch` - mirrors
// src/lib/mailer.ts's sendEmail() exactly (same "throw per-send, caller
// catches/logs" contract, same delivery-log-everything approach).
// WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are empty placeholders in
// .env until real Meta Business credentials are supplied; until then this
// throws a descriptive error per-send that callers are expected to catch.
//
// Every send attempt (success or failure) is persisted to
// crm_whatsapp_delivery_log, same reasoning as crm_email_delivery_log: a
// silently-failing send (invalid number, no active 24h session, expired
// token) previously had no record anywhere.
//
// Note on Meta's messaging rules (not something this code can work around):
// a plain text message only delivers if the recipient messaged this
// WhatsApp Business number within the last 24 hours (the "customer service
// window"). Outside that window, Meta requires a pre-approved message
// template (configured in Meta Business Manager, not in this codebase) -
// sendWhatsAppMessage() always sends a plain text body; template support
// would be a separate addition once a template is actually approved.

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';

let deliveryLogTableReady: Promise<void> | null = null;

const ensureDeliveryLogTable = async () => {
  if (!deliveryLogTableReady) {
    deliveryLogTableReady = sequelize.query(`
      CREATE TABLE IF NOT EXISTS crm_whatsapp_delivery_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        recipient VARCHAR(30) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL,
        provider_message_id VARCHAR(255) NULL,
        error TEXT NULL,
        actor_id INT NULL,
        lead_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_whatsapp_delivery_status (status),
        INDEX idx_whatsapp_delivery_recipient (recipient),
        INDEX idx_whatsapp_delivery_lead (lead_id),
        INDEX idx_whatsapp_delivery_created (created_at)
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
      `INSERT INTO crm_whatsapp_delivery_log (recipient, message, status, provider_message_id, error, actor_id, lead_id)
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
    console.error('Failed to record WhatsApp delivery log entry:', error);
  }
}

export async function sendWhatsAppMessage({ to, message, actorId, leadId }: {
  to: string;
  message: string;
  actorId?: number | null;
  leadId?: number | null;
}) {
  const digits = to.replace(/\D/g, '');
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!digits) {
    const error = 'No valid phone number to send to';
    void recordDelivery({ recipient: to, message, status: 'failed', error, actorId, leadId });
    throw new Error(error);
  }

  if (!accessToken || !phoneNumberId) {
    const error = 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not configured';
    void recordDelivery({ recipient: digits, message, status: 'failed', error, actorId, leadId });
    throw new Error(error);
  }

  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: digits,
        type: 'text',
        text: { body: message },
      }),
    });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : 'Network error calling WhatsApp Cloud API';
    void recordDelivery({ recipient: digits, message, status: 'failed', error: errMessage, actorId, leadId });
    throw error;
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const errMessage = `WhatsApp Cloud API error: ${res.status} ${json?.error?.message || JSON.stringify(json)}`;
    void recordDelivery({ recipient: digits, message, status: 'failed', error: errMessage, actorId, leadId });
    throw new Error(errMessage);
  }

  const providerMessageId = json?.messages?.[0]?.id ?? null;
  void recordDelivery({ recipient: digits, message, status: 'sent', providerMessageId, actorId, leadId });
  return json;
}

export interface WhatsAppDeliveryLogEntry {
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

export async function listWhatsAppDeliveryLog({
  status,
  leadId,
  limit = 100,
}: { status?: 'sent' | 'failed'; leadId?: number; limit?: number } = {}): Promise<WhatsAppDeliveryLogEntry[]> {
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
    `SELECT * FROM crm_whatsapp_delivery_log ${whereSql} ORDER BY created_at DESC LIMIT :limit`,
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
