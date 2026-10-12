import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { CrmEmployee } from '@/models/CrmEmployee';
import { requireAuth, isAuthError } from '@/lib/apiAuth';

export async function GET(request: NextRequest) {
  // Called from the Add/Edit Lead forms (e.g. to populate the Counselor
  // dropdown) across multiple roles, so this only checks broad lead
  // access rather than pinning it to one narrow permission.
  const auth = requireAuth(request, ['leads.view', 'leads.create']);
  if (isAuthError(auth)) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const branch = searchParams.get('branch');
    // Optional role-type filter, e.g. "counsellor" — matched against crm_role.type
    // so callers (like the Add Lead form's Counselor dropdown) can list only
    // employees holding that role instead of every active staff member.
    const roleType = searchParams.get('role');

    if (!roleType) {
      // No role filter requested: preserve the original unfiltered behavior
      // (used by callers that just need every active employee, e.g. lead edit page).
      const employees = await CrmEmployee.findAll({
        where: branch ? { status: 1, branch: Number(branch) } : { status: 1 },
        attributes: ['id', 'name', 'email', 'username', 'branch', 'role'],
        order: [['name', 'ASC']],
        raw: true
      });
      return NextResponse.json(employees);
    }

    // "counsellor" is a logical group, not a literal crm_role.type: after the
    // role restructuring the individual-contributor tier is Immigration
    // Advisor / Senior Immigration Advisor (legacy counsellor/sales types are
    // kept so older role rows still resolve).
    const roleTypes = roleType.toLowerCase() === 'counsellor' || roleType.toLowerCase() === 'counselor'
      ? ['immigration_advisor', 'senior_immigration_advisor', 'counsellor', 'counselor', 'sales']
      : [roleType];

    const conditions = ['e.status = 1', 'r.type IN (:roleTypes)'];
    const replacements: Record<string, unknown> = { roleTypes };
    if (branch) {
      conditions.push('e.branch = :branch');
      replacements.branch = Number(branch);
    }

    const employees = await sequelize.query(
      `SELECT e.id, e.name, e.email, e.username, e.branch, e.role
       FROM crm_employee e
       JOIN crm_role r ON r.id = e.role
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.name ASC`,
      { replacements, type: QueryTypes.SELECT }
    );

    return NextResponse.json(employees);
  } catch (error) {
    console.error('Error fetching active employees:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active employees' },
      { status: 500 }
    );
  }
}
