import { parseServerDate } from '@/utils/format';

/** A pending follow-up whose time has passed. `nowMs` is passed in so the rule stays pure. */
export function isFollowUpOverdue(status: string, reminderDate: string, nowMs: number): boolean {
  if (status !== 'pending') return false;
  const due = parseServerDate(reminderDate);
  return !!due && due.getTime() < nowMs;
}
