import { CrmLeaveType } from '@/models/CrmLeaveType';
import { sequelize } from '@/lib/sequelize';

// The leave policy types HR's entitlement table is built on (see HRService.leaveEntitlements).
// Used to seed crm_leave_type when it is empty - a fresh/reset database otherwise gives
// employees an empty Leave Type dropdown and no way to apply for leave.
export const DEFAULT_LEAVE_TYPES = [
  'Annual Leave',
  'Sick Leave',
  'Maternity Leave',
  'Paternity Leave',
  'Hajj Leave',
  'Bereavement Leave',
  'Unpaid Leave',
  'Compensatory Leave',
  'Emergency Leave',
];

/**
 * Single source of truth for "which leave types exist" - reads crm_leave_type
 * instead of each caller hand-maintaining its own copy of the name list (this
 * used to be duplicated across 4 files and could silently drift out of sync).
 * Entitlement-days/category policy for each type is a separate concern (see
 * HRService.leaveEntitlements) and intentionally isn't stored here.
 *
 * If the table has no rows at all (never seeded / database reset) the default
 * policy types are inserted once. Types an admin later disables keep their row
 * (status 0), so this never re-adds them.
 */
export async function getActiveLeaveTypeNames(): Promise<string[]> {
  const total = await CrmLeaveType.count();
  if (total === 0) {
    // Raw insert: id is auto-increment, but the model's creation type doesn't mark it optional.
    for (const name of DEFAULT_LEAVE_TYPES) {
      await sequelize.query('INSERT INTO crm_leave_type (name, status) VALUES (:name, 1)', { replacements: { name } });
    }
  }
  const rows = await CrmLeaveType.findAll({
    where: { status: 1 },
    order: [['id', 'ASC']],
    attributes: ['name'],
    raw: true,
  });
  return rows.map((r) => r.name);
}
