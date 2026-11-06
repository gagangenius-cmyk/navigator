-- followupstat = 1 means "nothing pending"; the real pending state is an open row in
-- crm_follow_up_reminders, which lib/leadSchedule.ts mirrors back (0 only while one is
-- open). With the old DEFAULT 0 every lead created without an explicit followupstat looked
-- like it had a pending follow-up. Metadata-only change: existing rows are NOT modified.
-- Optional safety net: the app now sets followupstat explicitly on every creation path.
ALTER TABLE crm_forum_leads ALTER COLUMN followupstat SET DEFAULT 1;
