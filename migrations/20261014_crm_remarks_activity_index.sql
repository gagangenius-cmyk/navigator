-- Speeds up the "Today's Activity" tab/badge (EXISTS on crm_remarks by lead + action + day).
ALTER TABLE crm_remarks ADD INDEX idx_remarks_lead_action_created (lead_id, action, created_at);
