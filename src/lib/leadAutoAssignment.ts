import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from './sequelize';
import { ensureEmployeeAttendanceTable, CHECKED_IN_TODAY_SQL } from './employeeAttendanceTable';
import { HRService } from '@/services/hr-service';
import { pickNextCandidate } from './roundRobinSelection';

export interface LeadAutoAssignmentInput {
  branchId: number;
  preferredEmployeeId?: number | null;
  forceAutoAssign?: boolean;
  roundRobin?: boolean;
  // Previewing an assignment must not move the rotation cursor.
  consumeRoundRobin?: boolean;
}

export interface LeadAutoAssignmentResult {
  assignedEmployeeId: number;
  counselorId: number;
  branchId: number;
  strategy: 'branch_allocation_round_robin' | 'branch_active_employee_round_robin' | 'manual_preferred' | 'fallback_employee';
  candidateCount: number;
  currentLeadCount: number;
}

interface AssignmentCandidate {
  id: number;
  name: string;
  branch: number | null;
  openLeadCount: number;
  sourceRank: number;
}

let roundRobinStateReady: Promise<void> | null = null;

// Eligibility now reads both attendance tables (CHECKED_IN_TODAY_SQL below),
// so both need to exist before that query runs.
const ensureAttendanceTable = async () => {
  await Promise.all([
    ensureEmployeeAttendanceTable(),
    HRService.ensureAttendanceRecordTable(),
  ]);
};

const ensureRoundRobinStateTable = async () => {
  if (!roundRobinStateReady) {
    roundRobinStateReady = sequelize.query(`
      CREATE TABLE IF NOT EXISTS crm_lead_round_robin_state (
        branch_id INT NOT NULL PRIMARY KEY,
        last_employee_id INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_lead_round_robin_last_employee (last_employee_id)
      )
    `).then(() => undefined).catch((error) => {
      roundRobinStateReady = null;
      throw error;
    });
  }
  await roundRobinStateReady;
};

const parseIdList = (value: unknown): number[] => {
  if (!value || typeof value !== 'string') return [];

  return value
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
};

const getAllocatedEmployeeIds = async (branchId: number, transaction?: Transaction): Promise<number[]> => {
  const rows = await sequelize.query<{ counsilors: string }>(
    `SELECT counsilors
     FROM crm_counsilor_allocations
     WHERE branch_id = :branchId AND status = 1
     ORDER BY created DESC, id DESC
     LIMIT 1`,
    {
      replacements: { branchId },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  return parseIdList(rows[0]?.counsilors);
};

const loadCandidates = async (
  branchId: number,
  allocatedEmployeeIds: number[],
  requireCheckedIn: boolean,
  transaction?: Transaction
): Promise<AssignmentCandidate[]> => {
  const hasAllocations = allocatedEmployeeIds.length > 0;
  const orderClause = hasAllocations
    ? `sourceRank ASC, FIELD(e.id, ${allocatedEmployeeIds.join(',')}) ASC`
    : 'sourceRank ASC, e.id ASC';
  const attendanceClause = requireCheckedIn ? `AND ${CHECKED_IN_TODAY_SQL}` : '';

  return sequelize.query<AssignmentCandidate>(
    `SELECT
        e.id,
        e.name,
        e.branch,
        COUNT(l.id) AS openLeadCount,
        CASE
          WHEN :hasAllocations = 1 AND e.id IN (:allocatedEmployeeIds) THEN 0
          ELSE 1
        END AS sourceRank
      FROM crm_employee e
      LEFT JOIN crm_forum_leads l
        ON l.assignTo = e.id
        AND COALESCE(l.status, '') NOT IN ('Converted', 'Closed', 'Lost', 'client', 'retained')
      WHERE e.status = 1
        ${attendanceClause}
        AND (
          (:hasAllocations = 1 AND e.id IN (:allocatedEmployeeIds))
          OR (:hasAllocations = 0 AND e.branch = :branchId)
        )
      GROUP BY e.id, e.name, e.branch
      ORDER BY ${orderClause}`,
    {
      replacements: {
        branchId,
        hasAllocations: hasAllocations ? 1 : 0,
        allocatedEmployeeIds: hasAllocations ? allocatedEmployeeIds : [0],
      },
      type: QueryTypes.SELECT,
      transaction,
    }
  );
};

const getNextRoundRobinCandidate = async (
  branchId: number,
  candidates: AssignmentCandidate[],
  transaction: Transaction,
  consumeRoundRobin: boolean
): Promise<AssignmentCandidate> => {
  if (consumeRoundRobin) {
    await sequelize.query(
      `INSERT INTO crm_lead_round_robin_state (branch_id, last_employee_id, created_at, updated_at)
       VALUES (:branchId, NULL, NOW(), NOW())
       ON DUPLICATE KEY UPDATE branch_id = branch_id`,
      {
        replacements: { branchId },
        transaction,
      }
    );
  }

  const stateRows = await sequelize.query<{ last_employee_id: number | null }>(
    `SELECT last_employee_id
     FROM crm_lead_round_robin_state
     WHERE branch_id = :branchId
     ${consumeRoundRobin ? 'FOR UPDATE' : ''}`,
    {
      replacements: { branchId },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  const selected = pickNextCandidate(candidates, stateRows[0]?.last_employee_id ?? null);

  if (consumeRoundRobin) {
    await sequelize.query(
      `UPDATE crm_lead_round_robin_state
       SET last_employee_id = :employeeId,
           updated_at = NOW()
       WHERE branch_id = :branchId`,
      {
        replacements: {
          branchId,
          employeeId: selected.id,
        },
        transaction,
      }
    );
  }

  return selected;
};

export const resolveLeadAutoAssignment = async ({
  branchId,
  preferredEmployeeId,
  forceAutoAssign = false,
  roundRobin = true,
  consumeRoundRobin = true,
}: LeadAutoAssignmentInput): Promise<LeadAutoAssignmentResult> => {
  const normalizedBranchId = Number.isFinite(branchId) && branchId > 0 ? branchId : 1;

  if (preferredEmployeeId && !forceAutoAssign) {
    return {
      assignedEmployeeId: preferredEmployeeId,
      counselorId: preferredEmployeeId,
      branchId: normalizedBranchId,
      strategy: 'manual_preferred',
      candidateCount: 1,
      currentLeadCount: 0,
    };
  }

  await ensureRoundRobinStateTable();
  await ensureAttendanceTable();

  return sequelize.transaction(async (transaction) => {
    const allocatedEmployeeIds = await getAllocatedEmployeeIds(normalizedBranchId, transaction);
    // Prefer checked-in employees, but if nobody is present keep rotating
    // across the active configured queue. Previously this path repeatedly
    // chose the lowest-id branch employee and ignored counselor allocations.
    let candidates = await loadCandidates(normalizedBranchId, allocatedEmployeeIds, true, transaction);
    if (candidates.length === 0) {
      candidates = await loadCandidates(normalizedBranchId, allocatedEmployeeIds, false, transaction);
    }
    let usingAllocatedQueue = allocatedEmployeeIds.length > 0 && candidates.length > 0;

    // A stale allocation roster (all configured employees inactive/deleted)
    // must not block an otherwise staffed branch. Fall back to the branch's
    // active queue, while still using the same fair cursor-based rotation.
    if (candidates.length === 0 && allocatedEmployeeIds.length > 0) {
      candidates = await loadCandidates(normalizedBranchId, [], true, transaction);
      if (candidates.length === 0) {
        candidates = await loadCandidates(normalizedBranchId, [], false, transaction);
      }
      usingAllocatedQueue = false;
    }
    const selected = candidates.length > 0 && roundRobin
      ? await getNextRoundRobinCandidate(normalizedBranchId, candidates, transaction, consumeRoundRobin)
      : candidates[0];

    if (!selected) {
      throw new Error(`No active employees are available for branch ${normalizedBranchId}`);
    }

    return {
      assignedEmployeeId: selected.id,
      counselorId: selected.id,
      branchId: selected.branch || normalizedBranchId,
      strategy: usingAllocatedQueue ? 'branch_allocation_round_robin' : 'branch_active_employee_round_robin',
      candidateCount: candidates.length,
      currentLeadCount: Number(selected.openLeadCount || 0),
    };
  });
};
