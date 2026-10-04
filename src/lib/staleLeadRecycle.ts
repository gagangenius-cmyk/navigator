import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { listAssignmentRules, findStaleRecycleTarget } from '@/lib/assignmentRuleEngine';
import { recordLeadAssignment } from '@/lib/leadRemarks';
import { ensureAssignedByRuleColumn } from '@/lib/ensureAssignedByRuleColumn';

export interface StaleRecycleResult {
  rulesChecked: number;
  scanned: number;
  recycled: number;
}

// A lead this engine assigned via a round-robin rule, sitting with its
// current owner past that rule's own stale_recycle_hours with zero logged
// activity since the assignment, gets handed to the next person in the same
// queue - an agent who never follows up stops silently hoarding a lead
// forever. Only ever touches leads crm_forum_leads.assigned_by_rule_id ties
// to an active rule that still has recycling turned on; a manual assignment,
// a different rule's lead, or a rule with stale_recycle_hours unset is never
// touched. Invoked on a schedule by src/lib/stale-lead-recycle-cron.ts.
export async function runStaleLeadRecycleSweep(limitPerRule = 100): Promise<StaleRecycleResult> {
  await ensureAssignedByRuleColumn();
  const rules = await listAssignmentRules();
  const activeRules = rules.filter((r) => r.isActive && r.staleRecycleHours && r.assignmentMode === 'round_robin');

  let scanned = 0;
  let recycled = 0;

  for (const rule of activeRules) {
    const staleLeads = await sequelize.query<{ id: number; assignTo: number }>(
      `SELECT l.id, l.assignTo
       FROM crm_forum_leads l
       WHERE l.assigned_by_rule_id = :ruleId
         AND l.assignTo IS NOT NULL
         AND COALESCE(l.status, '') NOT IN ('Converted', 'Closed', 'Lost', 'client', 'retained')
         AND l.transfer_date IS NOT NULL
         AND TIMESTAMPDIFF(HOUR, TIMESTAMP(l.transfer_date, COALESCE(l.transfer_time, '00:00:00')), NOW()) >= :hours
         AND NOT EXISTS (
           SELECT 1 FROM crm_remarks r
           WHERE r.leadId = l.id
             AND r.action <> 'lead_assigned'
             AND r.createdAt > TIMESTAMP(l.transfer_date, COALESCE(l.transfer_time, '00:00:00'))
         )
       ORDER BY l.transfer_date ASC
       LIMIT :limit`,
      { replacements: { ruleId: rule.id, hours: rule.staleRecycleHours, limit: limitPerRule }, type: QueryTypes.SELECT }
    );

    for (const lead of staleLeads) {
      scanned++;
      try {
        const target = await findStaleRecycleTarget(rule, lead.assignTo);
        if (!target || target.employeeId === lead.assignTo) continue;

        await sequelize.query(
          `UPDATE crm_forum_leads SET assignTo = :employeeId, Counsilor = :employeeId WHERE id = :leadId`,
          { replacements: { employeeId: target.employeeId, leadId: lead.id } }
        );
        await recordLeadAssignment({
          leadId: lead.id,
          oldAssignTo: lead.assignTo,
          newAssignTo: target.employeeId,
          actorId: null,
          actorRole: `System (stale-lead recycle, rule: ${rule.name}, ${rule.staleRecycleHours}h untouched)`,
          ruleId: rule.id,
        });
        recycled++;
      } catch (error) {
        console.error(`Stale-lead recycle failed for lead ${lead.id} under rule ${rule.id}:`, error);
      }
    }
  }

  return { rulesChecked: activeRules.length, scanned, recycled };
}
