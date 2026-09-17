import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { HRService } from '@/services/hr-service';
import { verifyToken } from '@/lib/auth';
import { isCeo } from '@/lib/roleChecks';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { logAudit } from '@/lib/auditLog';
import { captureError } from '@/lib/errorTracking';

let dbReady = false;
const ensureDB = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['employees.manage', 'hr.view', 'hr.self']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDB();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get('page') || '1'));
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || '10')));
    const search = searchParams.get('search') || '';
    const department = searchParams.get('department') || '';
    const status = searchParams.get('status') || '';
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const replacements: Record<string, unknown> = { limit, offset };

    if (search) {
      conditions.push('(e.name LIKE :search OR e.email LIKE :search OR e.username LIKE :search OR e.mobile LIKE :search)');
      replacements.search = `%${search}%`;
    }
    if (department) {
      conditions.push('e.department = :dept');
      replacements.dept = Number(department) || department;
    }
    if (status === 'active') { conditions.push('e.status = 1'); }
    else if (status === 'inactive') { conditions.push('e.status != 1'); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRow] = await sequelize.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM crm_employee e LEFT JOIN crm_department d ON d.id = e.department ${where}`,
      { replacements, type: QueryTypes.SELECT }
    );

    const [summary] = await sequelize.query<{ total: number; active: number; inactive: number; missingVisaDates: number; departments: number }>(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN e.status=1 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN e.status!=1 THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN e.visaExp IS NULL THEN 1 ELSE 0 END) AS missingVisaDates,
        COUNT(DISTINCT e.department) AS departments
       FROM crm_employee e LEFT JOIN crm_department d ON d.id = e.department ${where}`,
      { replacements, type: QueryTypes.SELECT }
    );

    const data = await sequelize.query(
      `SELECT e.id, e.name, COALESCE(e.email,'') AS email,
        COALESCE(e.cemail,'') AS cemail,
        COALESCE(e.mobile,'') AS mobile, COALESCE(e.cmobile,'') AS cmobile,
        e.department, d.name AS departmentName,
        e.role, r.name AS roleName, e.branch, b.branch AS branchName, e.region, rg.name AS regionName, e.status, e.EID,
        COALESCE(e.username,'') AS username,
        COALESCE(e.work_location,'Onshore') AS work_location,
        COALESCE(e.work_country,'') AS work_country,
        COALESCE(e.work_city,'') AS work_city,
        COALESCE(e.work_site,'') AS work_site,
        COALESCE(e.employment_type,'Full-time') AS employment_type,
        COALESCE(e.wfh,0) AS wfh,
        CAST(e.dob AS CHAR) AS dob,
        CAST(e.doj AS CHAR) AS doj,
        CAST(e.dol AS CHAR) AS dol,
        CAST(e.visaExp AS CHAR) AS visaExp,
        e.nationality, e.gender, e.ppNo, e.address, e.photo
       FROM crm_employee e
       LEFT JOIN crm_department d ON d.id = e.department
       LEFT JOIN crm_role r ON r.id = e.role
       LEFT JOIN crm_branch b ON b.id = e.branch
       LEFT JOIN crm_region rg ON rg.id = e.region
       ${where}
       ORDER BY e.id DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    const total = Number(countRow?.total || 0);
    return NextResponse.json({
      data,
      summary: {
        total: Number(summary?.total || 0),
        active: Number(summary?.active || 0),
        inactive: Number(summary?.inactive || 0),
        missingVisaDates: Number(summary?.missingVisaDates || 0),
        departments: Number(summary?.departments || 0),
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error fetching employees:', msg);
    return NextResponse.json({ error: 'Failed to fetch employees', details: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['employees.manage', 'hr.create']);
  if (isAuthError(auth)) return auth;
  try {
    const body = await request.json();
    const employee = await HRService.createEmployee(body);
    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create employee';
    console.error('Error creating employee:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireAuth(request, ['employees.manage', 'hr.update']);
  if (isAuthError(auth)) return auth;
  try {
    const body = await request.json();
    const id = Number.parseInt(String(body.id || ''), 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Valid employee id is required' }, { status: 400 });
    }
    // Before-state, so a role/status/branch change (the privilege-relevant
    // fields) can be diffed and audit-logged below - a plain field edit
    // (phone number, address, ...) isn't worth a log entry.
    const before = await HRService.getEmployeeById(id);
    const employee = await HRService.updateEmployee({ ...body, id });
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    const after = employee as { role?: number; status?: number; branch?: number };
    const beforeTyped = before as { role?: number; status?: number; branch?: number } | null;
    if (beforeTyped && (
      beforeTyped.role !== after.role || beforeTyped.status !== after.status || beforeTyped.branch !== after.branch
    )) {
      await logAudit({
        entityType: 'employee',
        entityId: id,
        action: 'employee_privileges_changed',
        summary: `Employee #${id} role/status/branch changed`,
        actorId: (auth as { id?: number }).id ?? null,
        actorRole: (auth as { roleName?: string; type?: string }).roleName || (auth as { type?: string }).type || null,
        before: { role: beforeTyped.role, status: beforeTyped.status, branch: beforeTyped.branch },
        after: { role: after.role, status: after.status, branch: after.branch },
      });
    }

    return NextResponse.json(employee);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update employee';
    console.error('Error updating employee:', error);
    captureError(error, { route: 'PUT /api/admin/employees' });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const currentUser = token ? verifyToken(token) : null;
    if (!currentUser || !isCeo(currentUser)) {
      return NextResponse.json({ error: 'Only the CEO can delete records' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = Number.parseInt(searchParams.get('id') || '', 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Valid employee id is required' }, { status: 400 });
    }
    const result = await HRService.softDeleteEmployee(id);
    await logAudit({
      entityType: 'employee',
      entityId: id,
      action: 'employee_deactivated',
      summary: `Employee #${id} deactivated`,
      actorId: currentUser.id,
      actorRole: currentUser.roleName || currentUser.type || null,
      after: { status: 0 },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error deleting employee:', error);
    captureError(error, { route: 'DELETE /api/admin/employees' });
    return NextResponse.json({ error: 'Failed to delete employee' }, { status: 500 });
  }
}
