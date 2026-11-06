-- One-time backfill: make every lead's own follow-up / appointment columns mirror
-- the real rows (crm_follow_up_reminders, appointments). From now on this is kept
-- in sync automatically (src/lib/leadSchedule.ts, model hooks). Idempotent - safe
-- to run more than once. Review on a copy first; it rewrites crm_forum_leads columns.

-- 1) Leads with at least one open (pending/rescheduled) reminder -> earliest one, pending.
UPDATE crm_forum_leads l
JOIN (
  SELECT lead_id, MIN(reminder_date) AS next_at
  FROM crm_follow_up_reminders
  WHERE COALESCE(status, 'pending') IN ('pending', 'rescheduled')
  GROUP BY lead_id
) r ON r.lead_id = l.id
SET l.followup = DATE(r.next_at), l.folowuptime = TIME(r.next_at), l.followupstat = 0;

-- 2) Leads with no open reminder -> nothing pending. Every new lead is created with
--    followup = creation time and followupstat = 0 (lib/leadDefaults), so without this
--    ~90% of leads look like they have a pending follow-up that was never scheduled.
UPDATE crm_forum_leads l
SET l.followupstat = 1
WHERE l.followupstat = 0
  AND NOT EXISTS (
    SELECT 1 FROM crm_follow_up_reminders r
    WHERE r.lead_id = l.id AND COALESCE(r.status, 'pending') IN ('pending', 'rescheduled')
  );

-- 3) Appointment column: earliest upcoming live booking (Dubai today), else latest live one.
SET @dubai_today = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+04:00'));

UPDATE crm_forum_leads l
JOIN (
  SELECT leadid, MIN(date) AS d
  FROM appointments
  WHERE leadid IS NOT NULL AND COALESCE(booked, 1) = 1 AND COALESCE(not_done, 0) = 0 AND COALESCE(done, 0) = 0
    AND date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND date >= @dubai_today
  GROUP BY leadid
) a ON a.leadid = l.id
SET l.appointment = a.d;

UPDATE crm_forum_leads l
JOIN (
  SELECT leadid, MAX(date) AS d
  FROM appointments
  WHERE leadid IS NOT NULL AND COALESCE(booked, 1) = 1 AND COALESCE(not_done, 0) = 0
    AND date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
  GROUP BY leadid
) a ON a.leadid = l.id
SET l.appointment = a.d
WHERE NOT EXISTS (
  SELECT 1 FROM appointments x
  WHERE x.leadid = l.id AND COALESCE(x.booked, 1) = 1 AND COALESCE(x.not_done, 0) = 0 AND COALESCE(x.done, 0) = 0
    AND x.date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND x.date >= @dubai_today
);
