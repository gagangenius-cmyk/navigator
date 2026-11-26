import { dubaiDay, dubaiTime, SQL_DUBAI_NOW } from './dubaiDate';
import { enqueueTransferNotice } from './leadTransferNotices';
import { Transaction, QueryTypes } from 'sequelize';
import { CrmRemarks } from '@/models/CrmRemarks';
import { sequelize } from '@/lib/sequelize';
import { notifyLeadAssigned } from '@/lib/notify';
import { CACHE_TAGS, invalidateReportCaches } from '@/lib/reportCache';
import { ensureAssignedByRuleColumn } from '@/lib/ensureAssignedByRuleColumn';

export type LeadRemarkAction =
  | 'lead_created'
  | 'lead_assigned'
  | 'status_changed'
  | 'remark_added'
  | 'remark_edited'
  | 'appointment_booked'
  | 'followup_added'
  | 'followup_completed'
  | 'followup_rescheduled'
  | 'followup_cancelled'
  | 'appointment_done'
  | 'appointment_not_done'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'whatsapp_sent'
  | 'email_sent'
  | 'duplicate_detected'
  | 'operations_case_transfer'
  | 'operations_case_status_changed'
  | 'operations_task_reassigned';

// THE list of crm_remarks actions that count as a counselor "working" a lead. Today's Activity (leads list tile +
// filter), the daily work report / export and the FTD-MTD daily sheet all read this one list, so a new kind of lead
// activity only has to be added here (and logged through logLeadRemark) to appear everywhere.
export const LEAD_WORK_ACTIONS: LeadRemarkAction[] = [
  'status_changed',
  'remark_added',
  'remark_edited',
  'followup_added',
  'followup_completed',
  'followup_rescheduled',
  'followup_cancelled',
  'appointment_booked',
  'appointment_done',
  'appointment_not_done',
  'appointment_rescheduled',
  'appointment_cancelled',
  'whatsapp_sent',
];

interface LogLeadRemarkInput {
  leadId: number;
  action: LeadRemarkAction;
  remark: string;
  previousValue?: string | null;
  newValue?: string | null;
  actorId?: number | null;
  actorRole?: string | null;
  transaction?: Transaction;
}

/**
 * Records a major lead action (assignment, status change, remark, appointment,
 * follow-up) into crm_remarks. Never throws — a failed audit write must not
 * roll back or block the primary action it's logging.
 */
export async function logLeadRemark({
  leadId,
  action,
  remark,
  previousValue = null,
  newValue = null,
  actorId = null,
  actorRole = null,
  transaction,
}: LogLeadRemarkInput): Promise<void> {
  try {
    await CrmRemarks.create(
      { leadId, action, remark, previousValue, newValue, actorId, actorRole },
      { transaction }
    );
  } catch (error) {
    console.error('Failed to record lead activity in crm_remarks:', error);
  }
}

interface AddLeadRemarkInput {
  leadId: number;
  text: unknown;
  actorId?: number | null;
  actorRole?: string | null;
  transaction?: Transaction;
}

// Placeholders the forms send when nobody typed anything - not remarks.
const AUTO_TEXTS = new Set(['lead follow-up', 'prospect follow-up scheduled']);

/**
 * THE central place for anything a person types about a lead - the remark popup, status updates, follow-ups
 * (add / complete / reschedule / cancel), appointments and the lead forms all call this. Each remark is stored in the
 * lead's remark history (crm_forum_leads_remarks), becomes the lead's latest remark, and appears in the activity log
 * as "Lead Remark" ('remark_added').
 *
 * One popup can send the same text to two or three endpoints (remark + follow-up + appointment), so an identical
 * remark on the same lead within a minute is recorded once. Never throws: it must not fail the action it came with.
 * Returns false when nothing new was recorded.
 */
export async function addLeadRemark({ leadId, text, actorId = null, actorRole = null, transaction }: AddLeadRemarkInput): Promise<boolean> {
  const remark = typeof text === 'string' ? text.trim() : '';
  const id = Number(leadId);
  if (!id || !remark || AUTO_TEXTS.has(remark.toLowerCase())) return false;
  try {
    const now = new Date();
    const date = dubaiDay(now);
    const time = dubaiTime(now);
    const [recent] = await sequelize.query<{ id: number }>(
      `SELECT id FROM crm_forum_leads_remarks
       WHERE \`lead\` = :id AND remark = :remark AND TIMESTAMP(\`date\`, created) >= (${SQL_DUBAI_NOW} - INTERVAL 60 SECOND)
       LIMIT 1`,
      { replacements: { id, remark }, type: QueryTypes.SELECT, transaction },
    );
    if (recent) return false;

    await sequelize.query(
      'INSERT INTO crm_forum_leads_remarks (`lead`, `date`, remark, emp, created, `status`) VALUES (:id, :date, :remark, :emp, :time, 1)',
      { replacements: { id, date, remark, emp: actorId ?? 0, time }, type: QueryTypes.INSERT, transaction },
    );
    await sequelize.query(
      'UPDATE crm_forum_leads SET lead_remark = :remark, last_updated = :date, last_updtd_time = :time WHERE id = :id',
      { replacements: { id, remark, date, time }, type: QueryTypes.UPDATE, transaction },
    );
    await logLeadRemark({ leadId: id, action: 'remark_added', remark, actorId, actorRole, transaction });
    return true;
  } catch (error) {
    console.error('Failed to record lead remark:', error);
    return false;
  }
}

interface RecordLeadAssignmentInput {
  leadId: number;
  oldAssignTo: number | null;
  newAssignTo: number | null;
  actorId?: number | null;
  actorRole?: string | null;
  // The Assignment Rule (crm_assignment_rules.id) that produced newAssignTo,
  // when this assignment came from resolveLeadAssignment()'s rule-engine
  // branch - stamped onto crm_forum_leads.assigned_by_rule_id so the
  // stale-lead recycle sweep can later recycle this lead through the same
  // rule's queue. Left null/omitted for every non-rule assignment (manual
  // pick, pool self-claim, branch-fallback round robin, etc.) - those are
  // never eligible for automatic recycling.
  ruleId?: number | null;
  transaction?: Transaction;
}

/**
 * The single place every lead-assignment code path (manual reassignment,
 * lead-pool claim, auto-assignment, lead creation, ...) should call whenever
 * it changes a lead's assignTo. Stamps crm_forum_leads.transfer_date/
 * transfer_time/transfered/transfered_by (the "assigned since" audit fields
 * — already used correctly by the Edit Lead PUT flow, just not by any other
 * assignment path), logs a `lead_assigned` entry into crm_remarks recording
 * who assigned the lead to whom, and — only on a genuine unassigned→assigned
 * transition — clears a lead still sitting at the system-set 'untouched'
 * status to 'New', since it no longer meets "unassigned and untouched".
 *
 * No-ops if oldAssignTo === newAssignTo (re-saving the same assignee must
 * not reset the assigned-since date). Never throws, matching logLeadRemark.
 */
export async function recordLeadAssignment({
  leadId,
  oldAssignTo,
  newAssignTo,
  actorId = null,
  actorRole = null,
  ruleId = null,
  transaction,
}: RecordLeadAssignmentInput): Promise<void> {
  if (oldAssignTo === newAssignTo) return;
  try {
    await ensureAssignedByRuleColumn();
    const employeeIds = [oldAssignTo, newAssignTo].filter((v): v is number => v !== null);
    const employeeNames = employeeIds.length
      ? await sequelize.query<{ id: number; name: string }>(
          'SELECT id, name FROM crm_employee WHERE id IN (:ids)',
          { replacements: { ids: employeeIds }, type: QueryTypes.SELECT, transaction }
        )
      : [];
    const nameOf = (empId: number | null) =>
      empId === null ? 'Unassigned' : employeeNames.find((e) => e.id === empId)?.name || `Employee #${empId}`;

    const now = new Date();
    const clearsUntouched = oldAssignTo === null && newAssignTo !== null;
    // crm_forum_leads.transfered_by is NOT NULL (a legacy constraint - see
    // leadDefaults.ts's own `transfered_by: data.transfered_by || 1`), but
    // every assignment path until now has always had a real human actorId.
    // The lead pool SLA sweep (src/lib/leadPool.ts runSlaSweep) is the first
    // fully-automatic path with no human actor at all - falls back to
    // employee id 1, the same "system" sentinel leadDefaults.ts already uses,
    // rather than violating the constraint and losing the audit trail entirely.
    await sequelize.query(
      `UPDATE crm_forum_leads
       SET transfer_date = ?, transfer_time = ?, transfered = 1, transfered_by = ?, assigned_by_rule_id = ?
           ${clearsUntouched ? ", status = IF(status = 'untouched', 'New', status)" : ''}
       WHERE id = ?`,
      {
        replacements: [dubaiDay(now), dubaiTime(now), actorId ?? 1, ruleId ?? null, leadId],
        transaction,
      }
    );

    let actorLabel = actorRole ? `(${actorRole})` : '';
    if (actorId) {
      const [actorRow] = await sequelize.query<{ name: string }>(
        'SELECT name FROM crm_employee WHERE id = :id LIMIT 1',
        { replacements: { id: actorId }, type: QueryTypes.SELECT, transaction }
      );
      actorLabel = `${actorRow?.name || `Employee #${actorId}`} ${actorLabel}`.trim();
    } else {
      actorLabel = actorLabel || 'System';
    }

    await logLeadRemark({
      leadId,
      action: 'lead_assigned',
      remark: `Lead assigned from ${nameOf(oldAssignTo)} to ${nameOf(newAssignTo)} by ${actorLabel}`,
      previousValue: nameOf(oldAssignTo),
      newValue: nameOf(newAssignTo),
      actorId,
      actorRole,
      transaction,
    });

    // Notify the new owner - this is the single hook every assignment path
    // (manual, round robin, rule engine, inactivity reassignment) already
    // calls, so it's the one place a "lead assigned to you" alert can live
    // without wiring notifications into each individual call site.
    await notifyLeadAssigned({ leadId, newAssignTo, actorId, actorLabel, transaction });

    // Email the new counselor. Queued here, sent in batches (leadTransferNotices.ts): one lead gets
    // the full-detail email, several leads moved in the same action are clubbed into one email.
    await enqueueTransferNotice({ leadId, oldAssignTo, newAssignTo, actorId, actorRole, transaction });

    // Every reassignment path (manual, lead pool claim/release, bulk
    // transfer, round-robin, SLA sweep) funnels through this one function -
    // the choke point to invalidate cached dashboard/report aggregates.
    invalidateReportCaches([CACHE_TAGS.leads]);
  } catch (error) {
    console.error('Failed to record lead assignment:', error);
  }
}
