import type { SessionUser } from '@/features/auth/types';
import { resolveNotificationRoute, type PushTarget } from '@/services/push/router';
import { PUSH_TYPES, type PushType } from '@/services/push/types';
import type { NotificationRow } from './api';

const isPushType = (value: string): value is PushType => (PUSH_TYPES as readonly string[]).includes(value);

/**
 * Where tapping a row in the notification feed should go. The four push events reuse the
 * push router (so the feed and the lock-screen notification always agree, and both respect
 * role checks); anything else that points at a lead just opens that lead.
 */
export function targetForNotification(row: NotificationRow, user: SessionUser | null): PushTarget | null {
  if (row.relatedType !== 'lead' || !row.relatedId) return null;
  if (isPushType(row.type)) {
    return resolveNotificationRoute({ type: row.type, relatedId: String(row.relatedId), leadId: String(row.relatedId) }, user);
  }
  return { kind: 'lead', leadId: row.relatedId };
}
