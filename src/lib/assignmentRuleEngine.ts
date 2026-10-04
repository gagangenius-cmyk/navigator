import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from './sequelize';
import { resolveLeadAutoAssignment, LeadAutoAssignmentResult } from './leadAutoAssignment';
import { ensureEmployeeAttendanceTable, CHECKED_IN_TODAY_SQL } from './employeeAttendanceTable';
import { HRService } from '@/services/hr-service';
import { getAssignmentSettings } from './assignmentSettings';
import { pickSmoothWeighted } from './roundRobinSelection';

// Enterprise-style "Assignment Rules" engine (the concept Zoho calls Assignment
// Rules / Rule Entries and Salesforce calls Lead Assignment Rules): an ordered
// list of condition -> owner rules, evaluated top to bottom, first match wins.
// This sits ON TOP of the existing branch-level round robin in
// leadAutoAssignment.ts rather than replacing it - a lead that matches no
// active rule (or whose matched rule has no eligible candidate right now)
// still falls back to that battle-tested per-branch rotation, so this file
// can only ever make assignment MORE specific, never break the existing path.

export type AssignmentMode = 'round_robin' | 'specific_employee';

export interface AssignmentRule {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  branchIds: number[];
  sourceIds: number[];
  priorities: string[];
  leadQualities: string[];
  countryInterestIds: number[];
  serviceInterestIds: number[];
  // Free-text, case-insensitive (crm_forum_leads.campaign has no fixed
  // vocabulary - unlike branch/source these are whatever marketing typed in).
  campaigns: string[];
  // Case-insensitive match against crm_forum_leads.status, values drawn from
  // the same crm_lead_status config table the Leads list's own filter uses.
  statuses: string[];
  assignmentMode: AssignmentMode;
  employeeIds: number[];
  // Per-employee share of the rotation within this rule's queue - keyed by
  // employee id, default 1 for anyone not listed (or when the rule has no
  // weighting configured at all, every member is an equal 1). Round-robin
  // only; meaningless for 'specific_employee' mode.
  employeeWeights: Record<number, number>;
  // Subset of employeeIds exempt from the "checked in today" requirement -
  // they stay eligible for this rule's rotation 24/7 even if nobody marks
  // them present, while every other member of the same queue still needs to.
  alwaysAvailableEmployeeIds: number[];
  // Skip a queue member once their open-lead count reaches this, instead of
  // assigning them more than they can realistically handle. null = unlimited.
  maxOpenLeadsPerEmployee: number | null;
  // If set, a lead this rule assigned that sees no activity (no remark,
  // status change, follow-up, etc. after the assignment) for this many hours
  // gets automatically recycled to the next person in the same round-robin
  // queue (src/lib/staleLeadRecycle.ts). null/0 = disabled.
  staleRecycleHours: number | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: number | null;
  updatedBy?: number | null;
}

export interface AssignmentRuleInput {
  name: string;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  branchIds?: number[];
  sourceIds?: number[];
  priorities?: string[];
  leadQualities?: string[];
  countryInterestIds?: number[];
  serviceInterestIds?: number[];
  campaigns?: string[];
  statuses?: string[];
  assignmentMode: AssignmentMode;
  employeeIds: number[];
  employeeWeights?: Record<number, number>;
  alwaysAvailableEmployeeIds?: number[];
  maxOpenLeadsPerEmployee?: number | null;
  staleRecycleHours?: number | null;
}

export interface LeadAssignmentContext {
  branchId: number;
  sourceId?: number | null;
  priority?: string | null;
  leadQuality?: string | null;
  countryInterestId?: number | null;
  serviceInterestId?: number | null;
  campaign?: string | null;
  status?: string | null;
  preferredEmployeeId?: number | null;
  forceAutoAssign?: boolean;
  roundRobin?: boolean;
  // Previewing an assignment must not move any rotation cursor.
  consumeRoundRobin?: boolean;
}

export interface RuleAssignmentResult extends LeadAutoAssignmentResult {
  ruleId?: number;
  ruleName?: string;
}

interface RuleRow {
  id: number;
  name: string;
  description: string | null;
  is_active: number;
  sort_order: number;
  branch_ids: string | null;
  source_ids: string | null;
  priorities: string | null;
  lead_qualities: string | null;
  country_interest_ids: string | null;
  service_interest_ids: string | null;
  campaigns: string | null;
  statuses: string | null;
  assignment_mode: AssignmentMode;
  employee_ids: string;
  employee_weights: string | null;
  always_available_employee_ids: string | null;
  max_open_leads_per_employee: number | null;
  stale_recycle_hours: number | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  updated_by: number | null;
}

let rulesTableReady: Promise<void> | null = null;
let ruleStateTableReady: Promise<void> | null = null;

// crm_next and every other already-deployed install created this table before
// employee_weights/max_open_leads_per_employee existed - CREATE TABLE IF NOT
// EXISTS alone never adds columns to an existing table, so this lazily ALTERs
// them in, same pattern as every other "ensure column" helper added this
// session (vat_included, is_deleted, premium_fee_1/2).
const ensureWeightingColumns = async () => {
  const [rows] = await sequelize.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_assignment_rules'
      AND COLUMN_NAME IN ('employee_weights', 'max_open_leads_per_employee', 'campaigns', 'statuses', 'always_available_employee_ids', 'stale_recycle_hours')
  `);
  const existing = new Set(((rows as Array<{ COLUMN_NAME: string }>) || []).map((r) => r.COLUMN_NAME));
  if (!existing.has('employee_weights')) {
    await sequelize.query(`ALTER TABLE crm_assignment_rules ADD COLUMN employee_weights VARCHAR(2000) NULL`);
  }
  if (!existing.has('max_open_leads_per_employee')) {
    await sequelize.query(`ALTER TABLE crm_assignment_rules ADD COLUMN max_open_leads_per_employee INT NULL`);
  }
  if (!existing.has('campaigns')) {
    await sequelize.query(`ALTER TABLE crm_assignment_rules ADD COLUMN campaigns VARCHAR(1000) NULL`);
  }
  if (!existing.has('statuses')) {
    await sequelize.query(`ALTER TABLE crm_assignment_rules ADD COLUMN statuses VARCHAR(500) NULL`);
  }
  if (!existing.has('always_available_employee_ids')) {
    await sequelize.query(`ALTER TABLE crm_assignment_rules ADD COLUMN always_available_employee_ids VARCHAR(500) NULL`);
  }
  if (!existing.has('stale_recycle_hours')) {
    await sequelize.query(`ALTER TABLE crm_assignment_rules ADD COLUMN stale_recycle_hours INT NULL`);
  }
};

const ensureAssignmentRulesTable = async () => {
  if (!rulesTableReady) {
    rulesTableReady = (async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_assignment_rules (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          description TEXT NULL,
          is_active TINYINT NOT NULL DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 0,
          branch_ids VARCHAR(255) NULL,
          source_ids VARCHAR(255) NULL,
          priorities VARCHAR(150) NULL,
          lead_qualities VARCHAR(255) NULL,
          country_interest_ids VARCHAR(255) NULL,
          service_interest_ids VARCHAR(255) NULL,
          campaigns VARCHAR(1000) NULL,
          statuses VARCHAR(500) NULL,
          assignment_mode VARCHAR(20) NOT NULL DEFAULT 'round_robin',
          employee_ids VARCHAR(1000) NOT NULL,
          employee_weights VARCHAR(2000) NULL,
          always_available_employee_ids VARCHAR(500) NULL,
          max_open_leads_per_employee INT NULL,
          stale_recycle_hours INT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          created_by INT NULL,
          updated_by INT NULL,
          INDEX idx_assignment_rules_active_order (is_active, sort_order),
          CONSTRAINT fk_assignment_rules_created_by FOREIGN KEY (created_by) REFERENCES crm_employee(id) ON DELETE SET NULL,
          CONSTRAINT fk_assignment_rules_updated_by FOREIGN KEY (updated_by) REFERENCES crm_employee(id) ON DELETE SET NULL
        )
      `);
      await ensureWeightingColumns();
    })().catch((error) => {
      rulesTableReady = null;
      throw error;
    });
  }
  await rulesTableReady;
};

const ensureRuleStateTable = async () => {
  if (!ruleStateTableReady) {
    ruleStateTableReady = (async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_assignment_rule_state (
          rule_id INT NOT NULL PRIMARY KEY,
          last_employee_id INT NULL,
          current_weights TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_assignment_rule_state_rule FOREIGN KEY (rule_id) REFERENCES crm_assignment_rules(id) ON DELETE CASCADE,
          CONSTRAINT fk_assignment_rule_state_employee FOREIGN KEY (last_employee_id) REFERENCES crm_employee(id) ON DELETE SET NULL
        )
      `);
      const [rows] = await sequelize.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_assignment_rule_state' AND COLUMN_NAME = 'current_weights'
      `);
      if (!(rows as Array<{ COLUMN_NAME: string }>).length) {
        await sequelize.query(`ALTER TABLE crm_assignment_rule_state ADD COLUMN current_weights TEXT NULL`);
      }
    })().catch((error) => {
      ruleStateTableReady = null;
      throw error;
    });
  }
  await ruleStateTableReady;
};

const parseIdList = (value: unknown): number[] => {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
};

const parseStringList = (value: unknown): string[] => {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const toCsv = (values: Array<string | number> | undefined | null): string | null => {
  if (!values || values.length === 0) return null;
  return values.map((v) => String(v).trim()).filter(Boolean).join(',');
};

// employee_weights is a CSV of integers parallel-indexed to employee_ids
// (e.g. employee_ids="12,7,19", employee_weights="1,2,1" -> employee 7 gets
// double the share). A missing, shorter, or non-numeric entry defaults to 1,
// so a rule saved before weighting existed (or with no weights set) behaves
// as a plain, perfectly uniform round robin - weighting is purely additive.
const parseWeights = (value: string | null, employeeIds: number[]): Record<number, number> => {
  const parts = (value || '').split(',');
  const weights: Record<number, number> = {};
  employeeIds.forEach((id, index) => {
    const parsed = Number.parseInt((parts[index] || '').trim(), 10);
    weights[id] = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  });
  return weights;
};

const weightsToCsv = (weights: Record<number, number> | undefined, employeeIds: number[]): string | null => {
  if (!weights) return null;
  return employeeIds.map((id) => {
    const w = weights[id];
    return Number.isFinite(w) && w > 0 ? Math.round(w) : 1;
  }).join(',');
};

// sequelize.query()'s raw return shape for an INSERT varies by how the
// replacements were passed - handles both the [insertId, meta] tuple and a
// nested { insertId } object, mirroring the proven-working helper in
// src/app/api/leads/route.ts rather than assuming one fixed shape.
function extractInsertId(result: unknown): number {
  const values = Array.isArray(result) ? result : [result];
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    if (value && typeof value === 'object') {
      const insertId = (value as { insertId?: unknown }).insertId;
      if (typeof insertId === 'number' && Number.isInteger(insertId) && insertId > 0) return insertId;
      if (typeof insertId === 'string' && Number.isInteger(Number(insertId)) && Number(insertId) > 0) return Number(insertId);
    }
  }
  return 0;
}

const rowToRule = (row: RuleRow): AssignmentRule => ({
  id: row.id,
  name: row.name,
  description: row.description,
  isActive: Boolean(row.is_active),
  sortOrder: row.sort_order,
  branchIds: parseIdList(row.branch_ids),
  sourceIds: parseIdList(row.source_ids),
  priorities: parseStringList(row.priorities),
  leadQualities: parseStringList(row.lead_qualities),
  countryInterestIds: parseIdList(row.country_interest_ids),
  serviceInterestIds: parseIdList(row.service_interest_ids),
  campaigns: parseStringList(row.campaigns),
  statuses: parseStringList(row.statuses),
  assignmentMode: row.assignment_mode,
  employeeIds: parseIdList(row.employee_ids),
  employeeWeights: parseWeights(row.employee_weights, parseIdList(row.employee_ids)),
  alwaysAvailableEmployeeIds: parseIdList(row.always_available_employee_ids),
  maxOpenLeadsPerEmployee: row.max_open_leads_per_employee ?? null,
  staleRecycleHours: row.stale_recycle_hours ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  createdBy: row.created_by,
  updatedBy: row.updated_by,
});

// --- CRUD -------------------------------------------------------------

export async function listAssignmentRules(): Promise<AssignmentRule[]> {
  await ensureAssignmentRulesTable();
  const rows = await sequelize.query<RuleRow>(
    'SELECT * FROM crm_assignment_rules ORDER BY sort_order ASC, id ASC',
    { type: QueryTypes.SELECT }
  );
  return rows.map(rowToRule);
}

export async function getAssignmentRuleById(id: number): Promise<AssignmentRule | null> {
  await ensureAssignmentRulesTable();
  const rows = await sequelize.query<RuleRow>(
    'SELECT * FROM crm_assignment_rules WHERE id = :id LIMIT 1',
    { replacements: { id }, type: QueryTypes.SELECT }
  );
  return rows[0] ? rowToRule(rows[0]) : null;
}

function validateRuleInput(input: AssignmentRuleInput) {
  if (!input.name || !input.name.trim()) throw new Error('Rule name is required');
  if (!input.assignmentMode || !['round_robin', 'specific_employee'].includes(input.assignmentMode)) {
    throw new Error('assignmentMode must be "round_robin" or "specific_employee"');
  }
  if (!Array.isArray(input.employeeIds) || input.employeeIds.length === 0) {
    throw new Error('At least one employee must be selected');
  }
  if (input.assignmentMode === 'specific_employee' && input.employeeIds.length !== 1) {
    throw new Error('"specific_employee" mode requires exactly one employee');
  }
  if (
    input.maxOpenLeadsPerEmployee !== undefined && input.maxOpenLeadsPerEmployee !== null
    && (!Number.isFinite(input.maxOpenLeadsPerEmployee) || input.maxOpenLeadsPerEmployee < 1)
  ) {
    throw new Error('Max open leads per agent must be a positive number, or left blank for unlimited');
  }
  if (
    input.staleRecycleHours !== undefined && input.staleRecycleHours !== null
    && (!Number.isFinite(input.staleRecycleHours) || input.staleRecycleHours < 1)
  ) {
    throw new Error('Stale-lead recycle hours must be a positive number, or left blank to disable');
  }
}

export async function createAssignmentRule(input: AssignmentRuleInput, actorId?: number | null): Promise<AssignmentRule> {
  validateRuleInput(input);
  await ensureAssignmentRulesTable();

  let sortOrder = input.sortOrder;
  if (sortOrder === undefined || sortOrder === null) {
    const [{ maxOrder }] = await sequelize.query<{ maxOrder: number | null }>(
      'SELECT MAX(sort_order) AS maxOrder FROM crm_assignment_rules',
      { type: QueryTypes.SELECT }
    );
    sortOrder = (maxOrder ?? -1) + 1;
  }

  const insertResult = await sequelize.query(
    `INSERT INTO crm_assignment_rules
      (name, description, is_active, sort_order, branch_ids, source_ids, priorities,
       lead_qualities, country_interest_ids, service_interest_ids, campaigns, statuses, assignment_mode,
       employee_ids, employee_weights, always_available_employee_ids, max_open_leads_per_employee,
       stale_recycle_hours, created_by, updated_by)
     VALUES (:name, :description, :isActive, :sortOrder, :branchIds, :sourceIds, :priorities,
       :leadQualities, :countryInterestIds, :serviceInterestIds, :campaigns, :statuses, :assignmentMode,
       :employeeIds, :employeeWeights, :alwaysAvailableEmployeeIds, :maxOpenLeadsPerEmployee,
       :staleRecycleHours, :actorId, :actorId)`,
    {
      replacements: {
        name: input.name.trim(),
        description: input.description || null,
        isActive: input.isActive === false ? 0 : 1,
        sortOrder,
        branchIds: toCsv(input.branchIds),
        sourceIds: toCsv(input.sourceIds),
        priorities: toCsv(input.priorities),
        leadQualities: toCsv(input.leadQualities),
        countryInterestIds: toCsv(input.countryInterestIds),
        serviceInterestIds: toCsv(input.serviceInterestIds),
        campaigns: toCsv(input.campaigns),
        statuses: toCsv(input.statuses),
        assignmentMode: input.assignmentMode,
        employeeIds: toCsv(input.employeeIds),
        employeeWeights: weightsToCsv(input.employeeWeights, input.employeeIds),
        alwaysAvailableEmployeeIds: toCsv(input.alwaysAvailableEmployeeIds),
        maxOpenLeadsPerEmployee: input.maxOpenLeadsPerEmployee ?? null,
        staleRecycleHours: input.staleRecycleHours ?? null,
        actorId: actorId ?? null,
      },
      type: QueryTypes.INSERT,
    }
  );

  const insertId = extractInsertId(insertResult);
  const created = await getAssignmentRuleById(insertId);
  if (!created) throw new Error('Failed to load newly created assignment rule');
  return created;
}

export async function updateAssignmentRule(id: number, input: Partial<AssignmentRuleInput>, actorId?: number | null): Promise<AssignmentRule> {
  await ensureAssignmentRulesTable();
  const existing = await getAssignmentRuleById(id);
  if (!existing) throw new Error('Assignment rule not found');

  const merged: AssignmentRuleInput = {
    name: input.name ?? existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
    sortOrder: input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
    branchIds: input.branchIds ?? existing.branchIds,
    sourceIds: input.sourceIds ?? existing.sourceIds,
    priorities: input.priorities ?? existing.priorities,
    leadQualities: input.leadQualities ?? existing.leadQualities,
    countryInterestIds: input.countryInterestIds ?? existing.countryInterestIds,
    serviceInterestIds: input.serviceInterestIds ?? existing.serviceInterestIds,
    campaigns: input.campaigns ?? existing.campaigns,
    statuses: input.statuses ?? existing.statuses,
    assignmentMode: input.assignmentMode ?? existing.assignmentMode,
    employeeIds: input.employeeIds ?? existing.employeeIds,
    employeeWeights: input.employeeWeights ?? existing.employeeWeights,
    alwaysAvailableEmployeeIds: input.alwaysAvailableEmployeeIds ?? existing.alwaysAvailableEmployeeIds,
    maxOpenLeadsPerEmployee: input.maxOpenLeadsPerEmployee !== undefined ? input.maxOpenLeadsPerEmployee : existing.maxOpenLeadsPerEmployee,
    staleRecycleHours: input.staleRecycleHours !== undefined ? input.staleRecycleHours : existing.staleRecycleHours,
  };
  validateRuleInput(merged);

  await sequelize.query(
    `UPDATE crm_assignment_rules SET
       name = :name, description = :description, is_active = :isActive, sort_order = :sortOrder,
       branch_ids = :branchIds, source_ids = :sourceIds, priorities = :priorities,
       lead_qualities = :leadQualities, country_interest_ids = :countryInterestIds,
       service_interest_ids = :serviceInterestIds, campaigns = :campaigns, statuses = :statuses,
       assignment_mode = :assignmentMode, employee_ids = :employeeIds, employee_weights = :employeeWeights,
       always_available_employee_ids = :alwaysAvailableEmployeeIds,
       max_open_leads_per_employee = :maxOpenLeadsPerEmployee, stale_recycle_hours = :staleRecycleHours,
       updated_by = :actorId
     WHERE id = :id`,
    {
      replacements: {
        id,
        name: merged.name.trim(),
        description: merged.description || null,
        isActive: merged.isActive === false ? 0 : 1,
        sortOrder: merged.sortOrder,
        branchIds: toCsv(merged.branchIds),
        sourceIds: toCsv(merged.sourceIds),
        priorities: toCsv(merged.priorities),
        leadQualities: toCsv(merged.leadQualities),
        countryInterestIds: toCsv(merged.countryInterestIds),
        serviceInterestIds: toCsv(merged.serviceInterestIds),
        campaigns: toCsv(merged.campaigns),
        statuses: toCsv(merged.statuses),
        assignmentMode: merged.assignmentMode,
        employeeIds: toCsv(merged.employeeIds),
        employeeWeights: weightsToCsv(merged.employeeWeights, merged.employeeIds),
        alwaysAvailableEmployeeIds: toCsv(merged.alwaysAvailableEmployeeIds),
        maxOpenLeadsPerEmployee: merged.maxOpenLeadsPerEmployee ?? null,
        staleRecycleHours: merged.staleRecycleHours ?? null,
        actorId: actorId ?? null,
      },
    }
  );

  const updated = await getAssignmentRuleById(id);
  if (!updated) throw new Error('Failed to load updated assignment rule');
  return updated;
}

export async function deleteAssignmentRule(id: number): Promise<void> {
  await ensureAssignmentRulesTable();
  await sequelize.query('DELETE FROM crm_assignment_rules WHERE id = :id', { replacements: { id } });
  await ensureRuleStateTable();
  await sequelize.query('DELETE FROM crm_assignment_rule_state WHERE rule_id = :id', { replacements: { id } });
}

export async function reorderAssignmentRules(orderedIds: number[]): Promise<void> {
  await ensureAssignmentRulesTable();
  await sequelize.transaction(async (transaction) => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await sequelize.query(
        'UPDATE crm_assignment_rules SET sort_order = :sortOrder WHERE id = :id',
        { replacements: { sortOrder: index, id: orderedIds[index] }, transaction }
      );
    }
  });
}

// --- Matching -----------------------------------------------------------

// A rule "dimension" (branch/source/priority/...) with no configured values
// is a wildcard - it matches every lead. A configured dimension only matches
// when the lead's value for that dimension is in the rule's list. This is
// the same semantics as Zoho's per-field "any/is one of" condition builder.
function matchesRule(rule: AssignmentRule, lead: LeadAssignmentContext): boolean {
  if (rule.branchIds.length > 0 && !rule.branchIds.includes(lead.branchId)) return false;
  if (rule.sourceIds.length > 0 && (!lead.sourceId || !rule.sourceIds.includes(lead.sourceId))) return false;
  if (rule.priorities.length > 0) {
    const p = (lead.priority || '').toLowerCase();
    if (!rule.priorities.some((v) => v.toLowerCase() === p)) return false;
  }
  if (rule.leadQualities.length > 0) {
    const q = (lead.leadQuality || '').toLowerCase();
    if (!rule.leadQualities.some((v) => v.toLowerCase() === q)) return false;
  }
  if (rule.countryInterestIds.length > 0 && (!lead.countryInterestId || !rule.countryInterestIds.includes(lead.countryInterestId))) return false;
  if (rule.serviceInterestIds.length > 0 && (!lead.serviceInterestId || !rule.serviceInterestIds.includes(lead.serviceInterestId))) return false;
  if (rule.campaigns.length > 0) {
    const c = (lead.campaign || '').toLowerCase();
    if (!rule.campaigns.some((v) => v.toLowerCase() === c)) return false;
  }
  if (rule.statuses.length > 0) {
    const s = (lead.status || '').toLowerCase();
    if (!rule.statuses.some((v) => v.toLowerCase() === s)) return false;
  }
  return true;
}

export async function findMatchingRule(lead: LeadAssignmentContext): Promise<AssignmentRule | null> {
  const rules = await listAssignmentRules();
  return rules.find((rule) => rule.isActive && matchesRule(rule, lead)) || null;
}

interface RuleCandidate {
  id: number;
  name: string;
  branch: number | null;
  openLeadCount: number;
}

async function loadRuleCandidates(
  employeeIds: number[],
  requireCheckedIn: boolean,
  alwaysAvailableIds: number[] = [],
  transaction?: Transaction
): Promise<RuleCandidate[]> {
  // Previously the only one of crm_employee_attendance's four consumers
  // that never called its own table-provisioning - relied entirely on
  // admin/attendance, admin/attendance/presence, or leadAutoAssignment.ts
  // having already run theirs first. Harmless on this deployment (the
  // table has existed since long before this session), but a real
  // "table doesn't exist" landmine on a fresh install if this code path
  // happened to run first. Now also ensures crm_hr_attendance_records,
  // since CHECKED_IN_TODAY_SQL reads both.
  if (requireCheckedIn) {
    await Promise.all([ensureEmployeeAttendanceTable(), HRService.ensureAttendanceRecordTable()]);
  }

  // alwaysAvailableIds are always a subset of this rule's own employee_ids,
  // already filtered to positive integers by parseIdList when the rule was
  // loaded - same trust basis as the existing employeeIds interpolation in
  // the ORDER BY FIELD(...) below, never raw user input.
  const alwaysAvailableOverride = requireCheckedIn && alwaysAvailableIds.length
    ? ` OR e.id IN (${alwaysAvailableIds.join(',')})`
    : '';
  const attendanceClause = requireCheckedIn ? `AND (${CHECKED_IN_TODAY_SQL}${alwaysAvailableOverride})` : '';

  return sequelize.query<RuleCandidate>(
    `SELECT e.id, e.name, e.branch, COUNT(l.id) AS openLeadCount
     FROM crm_employee e
     LEFT JOIN crm_forum_leads l
       ON l.assignTo = e.id
       AND COALESCE(l.status, '') NOT IN ('Converted', 'Closed', 'Lost', 'client', 'retained')
     WHERE e.status = 1
       AND e.id IN (:employeeIds)
       ${attendanceClause}
     GROUP BY e.id, e.name, e.branch
     ORDER BY FIELD(e.id, ${employeeIds.join(',')})`,
    { replacements: { employeeIds }, type: QueryTypes.SELECT, transaction }
  );
}

// True smooth weighted round-robin (SWRR) - the same algorithm Nginx/HAProxy
// use for weighted load balancing. Each candidate carries a persisted
// "current" counter (crm_assignment_rule_state.current_weights, a JSON map
// keyed by employee id); every pick: add each candidate's weight to its
// counter, select whoever's counter is now highest (first in list order on
// a tie), then subtract the total weight from only the selected candidate's
// counter. This - unlike indexing into a precomputed sequence by "find the
// last-picked employee's position" - handles a weight > 1 candidate being
// picked on consecutive turns of the underlying math correctly, since it
// never needs to locate a past pick in a list that can contain duplicates.
// A candidate list that shrinks/grows between calls (someone checks out, a
// new rule candidate becomes active) just starts that id's counter at 0,
// the correct SWRR initialization - no special-casing needed. When every
// weight is 1 (the default - every rule saved before weighting existed, or
// with no weights set), SWRR's own well-known property is that it degrades
// to a plain round-robin cycling through candidates in list order, so
// unweighted rules behave exactly as they did before this existed.
async function getNextRuleRoundRobinCandidate(
  ruleId: number,
  candidates: RuleCandidate[],
  weights: Record<number, number>,
  transaction: Transaction,
  consumeRoundRobin: boolean
): Promise<RuleCandidate> {
  if (consumeRoundRobin) {
    await sequelize.query(
      `INSERT INTO crm_assignment_rule_state (rule_id, last_employee_id, current_weights, created_at, updated_at)
       VALUES (:ruleId, NULL, NULL, NOW(), NOW())
       ON DUPLICATE KEY UPDATE rule_id = rule_id`,
      { replacements: { ruleId }, transaction }
    );
  }

  const stateRows = await sequelize.query<{ last_employee_id: number | null; current_weights: string | null }>(
    `SELECT last_employee_id, current_weights FROM crm_assignment_rule_state WHERE rule_id = :ruleId ${consumeRoundRobin ? 'FOR UPDATE' : ''}`,
    { replacements: { ruleId }, type: QueryTypes.SELECT, transaction }
  );

  let priorCurrent: Record<number, number> = {};
  try {
    priorCurrent = stateRows[0]?.current_weights ? JSON.parse(stateRows[0].current_weights) : {};
  } catch { priorCurrent = {}; }

  const { selected, nextCurrent } = pickSmoothWeighted(
    candidates,
    (c) => weights[c.id] ?? 1,
    priorCurrent,
    stateRows[0]?.last_employee_id ?? null
  );

  if (consumeRoundRobin) {
    await sequelize.query(
      'UPDATE crm_assignment_rule_state SET last_employee_id = :employeeId, current_weights = :currentWeights, updated_at = NOW() WHERE rule_id = :ruleId',
      { replacements: { ruleId, employeeId: selected.id, currentWeights: JSON.stringify(nextCurrent) }, transaction }
    );
  }

  return selected;
}

// Resolves a matched rule to a specific employee. Returns null (never
// throws) when the rule's configured pool is currently empty of eligible
// employees, so the caller can fall back to the branch-level engine instead
// of blocking lead creation on a misconfigured or fully-offline rule.
async function resolveRuleAssignment(
  rule: AssignmentRule,
  fallbackBranchId: number,
  consumeRoundRobin: boolean
): Promise<RuleAssignmentResult | null> {
  if (rule.assignmentMode === 'specific_employee') {
    const [employee] = await sequelize.query<{ id: number; branch: number | null; status: number }>(
      'SELECT id, branch, status FROM crm_employee WHERE id = :id LIMIT 1',
      { replacements: { id: rule.employeeIds[0] }, type: QueryTypes.SELECT }
    );
    if (!employee || Number(employee.status) !== 1) return null;
    return {
      assignedEmployeeId: employee.id,
      counselorId: employee.id,
      branchId: employee.branch || fallbackBranchId,
      strategy: 'manual_preferred',
      candidateCount: 1,
      currentLeadCount: 0,
      ruleId: rule.id,
      ruleName: rule.name,
    };
  }

  await ensureRuleStateTable();

  return sequelize.transaction(async (transaction) => {
    // Prefer only employees checked in today; if none of the rule's queue is
    // checked in, degrade to "active member of the queue" rather than
    // abandoning the rule entirely - mirrors the branch engine's own fallback.
    let candidates = await loadRuleCandidates(rule.employeeIds, true, rule.alwaysAvailableEmployeeIds, transaction);
    if (candidates.length === 0) {
      candidates = await loadRuleCandidates(rule.employeeIds, false, rule.alwaysAvailableEmployeeIds, transaction);
    }

    // Capacity cap: drop anyone already carrying rule.maxOpenLeadsPerEmployee
    // or more open leads, rather than piling still more onto someone over
    // their limit. If this empties the pool, resolveRuleAssignment returns
    // null exactly like "nobody checked in" does - the caller falls through
    // to the branch-level fallback engine, never blocking lead creation.
    if (rule.maxOpenLeadsPerEmployee !== null) {
      candidates = candidates.filter((c) => c.openLeadCount < rule.maxOpenLeadsPerEmployee!);
    }
    if (candidates.length === 0) return null;

    const selected = await getNextRuleRoundRobinCandidate(rule.id, candidates, rule.employeeWeights, transaction, consumeRoundRobin);
    return {
      assignedEmployeeId: selected.id,
      counselorId: selected.id,
      branchId: selected.branch || fallbackBranchId,
      strategy: 'branch_allocation_round_robin',
      candidateCount: candidates.length,
      currentLeadCount: Number(selected.openLeadCount || 0),
      ruleId: rule.id,
      ruleName: rule.name,
    };
  });
}

// Used only by the stale-lead recycle sweep (src/lib/staleLeadRecycle.ts):
// picks who a rule's round robin would hand a lead to NEXT, excluding the
// lead's current holder (recycling to the same person would be a no-op).
// Shares the rule's normal rotation cursor (crm_assignment_rule_state) - a
// recycle is just another real turn in the same queue, not a separate one.
export async function findStaleRecycleTarget(
  rule: AssignmentRule,
  excludeEmployeeId: number
): Promise<{ employeeId: number } | null> {
  if (rule.assignmentMode !== 'round_robin') return null;
  const pool = rule.employeeIds.filter((id) => id !== excludeEmployeeId);
  if (pool.length === 0) return null;

  await ensureRuleStateTable();
  return sequelize.transaction(async (transaction) => {
    let candidates = await loadRuleCandidates(pool, true, rule.alwaysAvailableEmployeeIds, transaction);
    if (candidates.length === 0) {
      candidates = await loadRuleCandidates(pool, false, rule.alwaysAvailableEmployeeIds, transaction);
    }
    if (rule.maxOpenLeadsPerEmployee !== null) {
      candidates = candidates.filter((c) => c.openLeadCount < rule.maxOpenLeadsPerEmployee!);
    }
    if (candidates.length === 0) return null;

    const selected = await getNextRuleRoundRobinCandidate(rule.id, candidates, rule.employeeWeights, transaction, true);
    return { employeeId: selected.id };
  });
}

// --- Orchestrator ---------------------------------------------------------

// The single entry point every lead-creation/assignment path should call.
// Order of precedence, matching how Zoho/Salesforce assignment rules layer
// on top of manual ownership:
//   1. An explicit preferred owner (manual pick) always wins outright.
//   2. The first active Assignment Rule whose conditions match the lead,
//      provided its queue currently has an eligible candidate.
//   3. The existing per-branch round robin (leadAutoAssignment.ts) as the
//      universal fallback - guarantees a lead is never stuck unassignable
//      just because no rule was configured or a rule's queue is empty.
export async function resolveLeadAssignment(context: LeadAssignmentContext): Promise<RuleAssignmentResult> {
  const { preferredEmployeeId, forceAutoAssign = false, roundRobin = true, consumeRoundRobin = true } = context;

  if (preferredEmployeeId && !forceAutoAssign) {
    // An explicit manual pick always wins outright - never gated by the
    // company-wide automatic-assignment toggle below, same as it's never
    // gated by anything else in this precedence chain.
    return resolveLeadAutoAssignment({
      branchId: context.branchId,
      preferredEmployeeId,
      forceAutoAssign,
      roundRobin,
      consumeRoundRobin,
    });
  }

  // CEO-level kill-switch (crm_assignment_settings, edited from the
  // Assignment Rules admin UI). Reuses the exact message substring every
  // real caller (leads/route.ts, lead-intake, webToLeadsIngest,
  // workflowRuntime, leadPool's SLA sweep, the admin Auto-Assign button)
  // already treats as "leave this lead unassigned in the pool, don't fail
  // the request" for an empty branch roster - so disabling automatic
  // assignment company-wide needs zero changes at any of those call sites.
  const settings = await getAssignmentSettings();
  if (!settings.roundRobinEnabled) {
    throw new Error('No active employees are available (automatic lead assignment is currently disabled)');
  }

  await ensureAssignmentRulesTable();
  const matchedRule = await findMatchingRule(context);
  if (matchedRule) {
    const ruleResult = await resolveRuleAssignment(matchedRule, context.branchId, consumeRoundRobin);
    if (ruleResult) return ruleResult;
  }

  return resolveLeadAutoAssignment({
    branchId: context.branchId,
    preferredEmployeeId,
    forceAutoAssign,
    roundRobin,
    consumeRoundRobin,
  });
}

// Non-consuming preview used by the admin UI: which rule would fire for a
// hypothetical lead, and who round robin would pick next, without moving
// any rotation cursor.
export async function previewLeadAssignment(context: Omit<LeadAssignmentContext, 'consumeRoundRobin'>): Promise<RuleAssignmentResult> {
  return resolveLeadAssignment({ ...context, forceAutoAssign: true, consumeRoundRobin: false });
}
