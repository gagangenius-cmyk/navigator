import { NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { getRecordVisibilityScope, isFinanceOrAccounts } from '@/lib/roleChecks';
import type { User } from '@/lib/auth';

/**
 * "May this user act on this specific lead" - the single-ID counterpart of the
 * branch/region/own scoping /api/leads applies to its list. Returns null when
 * access is fine, or a ready-to-return 404/403 NextResponse.
 *
 * 'own' scope also accepts a lead whose opportunity is assigned to / created
 * by the user, matching the list route's opportunity views.
 */
/**
 * Back-office roles (finance/accounts, compliance, operations/case management)
 * review records for every branch by design - their permission set, not their
 * branch, gates what they can do - so record-level branch/own scoping must not
 * apply to them or the verification/hand-off workflows would break.
 */
export function isCrossBranchWorkRole(user: User): boolean {
  if (isFinanceOrAccounts(user)) return true;
  const text = `${String(user.roleName || '')} ${String(user.type || '')}`.toLowerCase();
  return text.includes('compliance') || text.includes('operation') || text.includes('case manager') || text.includes('case officer');
}

export async function assertLeadAccess(user: User, leadId: number): Promise<NextResponse | null> {
  const scope = getRecordVisibilityScope(user);
  if (scope === 'all' || isCrossBranchWorkRole(user)) return null;

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

/** Same scope rule for a single opportunity, resolved through its lead. */
export async function assertOpportunityAccess(user: User, opportunityId: number): Promise<NextResponse | null> {
  if (!Number.isFinite(opportunityId) || opportunityId <= 0) {
    return NextResponse.json({ error: 'Invalid opportunity id' }, { status: 400 });
  }
  const scope = getRecordVisibilityScope(user);
  if (scope === 'all' || isCrossBranchWorkRole(user)) return null;

  const [row] = await sequelize.query<{ leadId: number | null }>(
    'SELECT leadId FROM crm_opportunities WHERE id = :opportunityId LIMIT 1',
    { replacements: { opportunityId }, type: QueryTypes.SELECT },
  );
  if (!row) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
  if (!row.leadId) return null;
  return assertLeadAccess(user, Number(row.leadId));
}

/**
 * Opportunity ids the user may see, or null when unrestricted. For list
 * endpoints that browse every opportunity's child records (documents,
 * agreements) rather than fetch one by id.
 */
export async function getScopedOpportunityIds(user: User): Promise<number[] | null> {
  const scope = getRecordVisibilityScope(user);
  if (scope === 'all' || isCrossBranchWorkRole(user)) return null;

  const rows = await sequelize.query<{ id: number }>(
    `SELECT o.id FROM crm_opportunities o
     LEFT JOIN crm_forum_leads l ON l.id = o.leadId
     WHERE o.is_deleted = 0 AND ${
       scope === 'branch'
         ? 'COALESCE(l.branch, o.branchId) = :branch'
         : scope === 'region'
           ? 'l.region = :region'
           : '(o.assignedTo = :uid OR o.createdBy = :uid OR l.assignTo = :uid OR l.Counsilor = :uid)'
     }`,
    { replacements: { branch: user.branch || 0, region: user.region || 0, uid: user.id }, type: QueryTypes.SELECT },
  );
  return rows.map((r) => Number(r.id));
}
