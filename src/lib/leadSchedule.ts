import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { dubaiToday } from '@/lib/dubaiDate';

// A lead's follow-up and appointment live in TWO places each:
//   follow-up   -> crm_follow_up_reminders (the real, multi-row store) and the
//                  lead's own followup / folowuptime / followupstat columns
//   appointment -> the appointments table and the lead's own `appointment` column
// The lead columns are what the Leads list, dashboard "Pending Follow-ups" tile,
// monitoring and branch reports read, so they must always mirror the real rows.
// Previously only one client popup updated them (with a second request that could
// fail silently), so every other creator/editor left them stale. Every code path
// that creates, reschedules, completes, cancels or deletes a reminder or an
// appointment must call the matching function below afterwards.

type Options = { transaction?: Transaction | null };

// 'rescheduled' is still an open, actionable follow-up (see
// follow-up-reminders/route.ts) - only completed/cancelled ones are closed.
export const OPEN_FOLLOW_UP_STATUSES = ['pending', 'rescheduled'] as const;

/**
 * Points the lead's follow-up columns at its earliest still-open reminder.
 * With none left, followupstat flips to 1 ("nothing pending") and the last date
 * is kept, because followup/folowuptime are NOT NULL columns.
 */
export async function syncLeadFollowup(leadId: number | string | null | undefined, options: Options = {}): Promise<void> {
  const id = Number(leadId);
  if (!Number.isFinite(id) || id <= 0) return;
  const transaction = options.transaction ?? undefined;

  const [next] = await sequelize.query<{ reminder_date: string }>(
    `SELECT reminder_date FROM crm_follow_up_reminders
     WHERE lead_id = :id AND COALESCE(status, 'pending') IN (:open)
     ORDER BY reminder_date ASC LIMIT 1`,
    { replacements: { id, open: [...OPEN_FOLLOW_UP_STATUSES] }, type: QueryTypes.SELECT, transaction },
  );

  if (next?.reminder_date) {
    const [datePart, timePart] = String(next.reminder_date).replace('T', ' ').split(' ');
    await sequelize.query(
      'UPDATE crm_forum_leads SET followup = :d, folowuptime = :t, followupstat = 0 WHERE id = :id',
      { replacements: { d: datePart, t: (timePart || '00:00:00').slice(0, 8), id }, type: QueryTypes.UPDATE, transaction },
    );
  } else {
    await sequelize.query(
      'UPDATE crm_forum_leads SET followupstat = 1 WHERE id = :id AND followupstat <> 1',
      { replacements: { id }, type: QueryTypes.UPDATE, transaction },
    );
  }
}

/**
 * Points the lead's `appointment` date at its earliest upcoming live booking,
 * else its most recent non-cancelled one, else NULL.
 */
export async function syncLeadAppointment(leadId: number | string | null | undefined, options: Options = {}): Promise<void> {
  const id = Number(leadId);
  if (!Number.isFinite(id) || id <= 0) return;
  const transaction = options.transaction ?? undefined;

  const live = `leadid = :id AND COALESCE(booked, 1) = 1 AND COALESCE(not_done, 0) = 0
                AND date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'`;

  const [upcoming] = await sequelize.query<{ date: string }>(
    `SELECT date FROM appointments
     WHERE ${live} AND COALESCE(done, 0) = 0 AND date >= :today
     ORDER BY date ASC, appointtime ASC LIMIT 1`,
    { replacements: { id, today: dubaiToday() }, type: QueryTypes.SELECT, transaction },
  );

  let date: string | null = upcoming?.date ? String(upcoming.date).slice(0, 10) : null;
  if (!date) {
    const [latest] = await sequelize.query<{ date: string }>(
      `SELECT date FROM appointments WHERE ${live} ORDER BY date DESC, appointtime DESC LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    date = latest?.date ? String(latest.date).slice(0, 10) : null;
  }

  await sequelize.query(
    'UPDATE crm_forum_leads SET appointment = :date WHERE id = :id',
    { replacements: { date, id }, type: QueryTypes.UPDATE, transaction },
  );
}
