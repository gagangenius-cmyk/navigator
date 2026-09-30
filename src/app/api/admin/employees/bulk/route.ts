import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { HRService } from '@/services/hr-service';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { findFullAdminEmployeeIds, FULL_ADMIN_PROTECTED_MESSAGE } from '@/lib/fullAdminEmployeeGuard';

// Deliberately bypasses HRService.updateEmployee() for activate/deactivate: that
// method does a full-column rewrite (every omitted field defaults to null), so
// a bulk {id, status} call through it would wipe out email/mobile/branch/etc.
// This route does a targeted UPDATE touching only the status column instead.
export async function PATCH(request: NextRequest) {
  const auth = requireAuth(request, ['employees.manage']);
  if (isAuthError(auth)) return auth;
  try {
    const body = await request.json();
    const { ids, action } = body as { ids: unknown[]; action: string };

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }
    const numericIds = ids.map(Number).filter((id) => id > 0);
    if (numericIds.length === 0) {
      return NextResponse.json({ error: 'No valid employee IDs' }, { status: 400 });
    }

    if (action === 'activate') {
      await sequelize.query(
        'UPDATE crm_employee SET status = 1 WHERE id IN (:ids)',
        { replacements: { ids: numericIds }, type: QueryTypes.UPDATE }
      );
      return NextResponse.json({ success: true, updated: numericIds.length });
    }

    if (action === 'deactivate') {
      // Full-admin accounts (CEO/Director/Founder/Super Admin) are excluded
      // from a bulk deactivate rather than failing the whole batch - this is
      // the same protection as the single-employee PUT/DELETE routes.
      const protectedIds = await findFullAdminEmployeeIds(numericIds);
      const targetIds = numericIds.filter((id) => !protectedIds.has(id));
      if (targetIds.length) {
        await sequelize.query(
          'UPDATE crm_employee SET status = 0 WHERE id IN (:ids)',
          { replacements: { ids: targetIds }, type: QueryTypes.UPDATE }
        );
      }
      return NextResponse.json({
        success: true,
        updated: targetIds.length,
        skipped: protectedIds.size,
        ...(protectedIds.size ? { skippedReason: FULL_ADMIN_PROTECTED_MESSAGE } : {}),
      });
    }

    if (action === 'delete') {
      const protectedIds = await findFullAdminEmployeeIds(numericIds);
      const targetIds = numericIds.filter((id) => !protectedIds.has(id));
      for (const id of targetIds) {
        await HRService.softDeleteEmployee(id);
      }
      return NextResponse.json({
        success: true,
        deleted: targetIds.length,
        skipped: protectedIds.size,
        ...(protectedIds.size ? { skippedReason: FULL_ADMIN_PROTECTED_MESSAGE } : {}),
      });
    }

    return NextResponse.json({ error: 'action must be activate, deactivate, or delete' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Bulk employee action error:', message);
    return NextResponse.json({ error: 'Failed to perform bulk action', details: message }, { status: 500 });
  }
}
