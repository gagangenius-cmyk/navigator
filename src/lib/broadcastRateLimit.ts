import { Op } from 'sequelize';
import { CrmBroadcastRecipients } from '@/models';

// Per-channel daily send quota (docs/broadcast-architecture.md Phase 6).
// Deliberately computed from crm_broadcast_recipients' own send timestamps
// rather than a new crm_*_quotas table + migration - the data this needs
// already exists (every send this system makes already writes sentAt), so
// a new table would just be a slower, more complex way to answer the same
// question. If per-branch or per-provider (rather than per-channel) quotas
// are ever needed, that's the point to add a real quotas table - this is
// intentionally the simplest thing that could work today.
//
// Unset env var = no limit (opt-in, not a surprise default that throttles
// an existing deployment that never asked for it).
function getDailyLimit(channel: 'email' | 'whatsapp' | 'sms'): number | null {
  const envVar = { email: 'BROADCAST_DAILY_LIMIT_EMAIL', whatsapp: 'BROADCAST_DAILY_LIMIT_WHATSAPP', sms: 'BROADCAST_DAILY_LIMIT_SMS' }[channel];
  const raw = process.env[envVar];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface QuotaCheckResult {
  withinQuota: boolean;
  limit: number | null;
  sentToday: number;
}

export async function checkDailyQuota(channel: 'email' | 'whatsapp' | 'sms'): Promise<QuotaCheckResult> {
  const limit = getDailyLimit(channel);
  if (limit === null) return { withinQuota: true, limit: null, sentToday: 0 };

  const midnightLocal = new Date();
  midnightLocal.setHours(0, 0, 0, 0);

  const sentToday = await CrmBroadcastRecipients.count({
    where: { channel, status: { [Op.in]: ['sent', 'delivered', 'read', 'replied'] }, sentAt: { [Op.gte]: midnightLocal } },
  });

  return { withinQuota: sentToday < limit, limit, sentToday };
}
