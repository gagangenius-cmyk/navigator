import { sequelize } from '@/lib/sequelize';
import { ensureTemplateSendTables } from './schema';

export type SendEvent =
  | 'created' | 'scheduled_released' | 'sent' | 'failed' | 'skipped' | 'retry_scheduled' | 'throttled' | 'cancelled' | 'reclaimed';

/**
 * Append-only log of everything that happens to a send (and to each recipient in it): the report
 * and the audit trail read from here. Never throws - a logging failure must not stop or undo a send.
 */
export async function logSendEvent(sendId: number, event: SendEvent, detail: string | Record<string, unknown> | null = null, opts: { itemId?: number | null; actorId?: number | null } = {}) {
  try {
    await ensureTemplateSendTables();
    const text = detail === null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 2000);
    await sequelize.query(
      'INSERT INTO crm_template_send_events (send_id, item_id, event, detail, actor_id) VALUES (:sendId, :itemId, :event, :detail, :actorId)',
      { replacements: { sendId, itemId: opts.itemId ?? null, event, detail: text, actorId: opts.actorId ?? null } },
    );
  } catch (error) {
    console.error('[template-send] could not write event log:', error);
  }
}
