import { NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { getRecordVisibilityScope } from '@/lib/roleChecks';
import type { User } from '@/lib/auth';

/**
 * "May this user act on this specific lead" - the single-ID counterpart of the
 * branch/region/own scoping /api/leads applies to its list. Returns null when
 * access is fine, or a ready-to-return 404/403 NextResponse.
 *
 * 'own' scope also accepts a lead whose opportunity is assigned to / created
 * by the user, matching the list route's opportunity views.
 */
export async function assertLeadAccess(user: User, leadId: number): Promise<NextResponse | null> {
  const scope = getRecordVisibilityScope(user);
  if (scope === 'all') return null;

  const [lead] = await sequelize.query<{
    branch: number | null;
    region: number | null;
    assignTo: number | null;
    Counsilor: number | null;
    onMyOpportunity: number;
  }>(
    `SELECT l.branch, l.region, l.assignTo, l.Counsilor,
            EXISTS (SELECT 1 FROM crm_opportunities o
                    WHERE o.leadId = l.id AND o.is_deleted = 0 AND (o.assignedTo = :uid OR o.createdBy = :uid)) AS onMyOpportunity
     FROM crm_forum_leads l WHERE l.id = :leadId LIMIT 1`,
    { replacements: { leadId, uid: user.id }, type: QueryTypes.SELECT },
  );

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const allowed = scope === 'branch'
    ? Number(lead.branch) === Number(user.branch)
    : scope === 'region'
      ? Number(lead.region) === Number(user.region)
      : Number(lead.Counsilor) === Number(user.id)
        || Number(lead.assignTo) === Number(user.id)
        || Number(lead.onMyOpportunity) === 1;

  return allowed ? null : NextResponse.json({ error: 'You do not have access to this lead' }, { status: 403 });
}
