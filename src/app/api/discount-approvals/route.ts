import { NextRequest, NextResponse } from 'next/server';
import { sequelize } from '@/lib/sequelize';
import { QueryTypes } from 'sequelize';
import { verifyToken } from '@/lib/auth';
import { isBranchManagerOrCeo, isCeo } from '@/lib/roleChecks';
import { branchCurrencyError, resolveBranchCurrency } from '@/lib/branchCurrency';
import { notifyRole } from '@/lib/notify';
import { getDiscountTier, discountTierLabel } from '@/lib/discountApproval';
import { getDiscountTierThresholds } from '@/lib/discountTierConfig';

function getAuthenticatedUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const token = request.cookies.get('auth-token')?.value || authorization?.replace(/^Bearer\s+/i, '');
  return token ? verifyToken(token) : null;
}

export async function GET(request: NextRequest) {
  try {
    const requester = getAuthenticatedUser(request);
    if (!requester) {
      return NextResponse.json({ success: false, error: 'Authentication is required' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get('leadId');
    const status = searchParams.get('status');
    const discountType = searchParams.get('discountType');
    const search = searchParams.get('search')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '20', 10));
    const offset = (page - 1) * limit;

    // Conditions shared by the returned rows AND the summary breakdown below
    // — status is deliberately excluded here and applied separately, so the
    // summary cards (Total/Pending/Approved/Rejected, each a clickable status
    // tab in the UI) always reflect every status at once rather than only
    // whichever tab happens to be selected.
    // Superseded (re-applied-over) requests are never shown in any list -
    // they're replaced by a fresh row the moment a counselor corrects a
    // wrong amount/approval (see POST's supersedesId handling below).
    const baseConditions: string[] = ['da.is_deleted = 0'];
    const baseReplacements: unknown[] = [];

    if (leadId) {
      baseConditions.push('da.leadId = ?');
      baseReplacements.push(leadId);
    }
    if (discountType) {
      baseConditions.push('da.discountType = ?');
      baseReplacements.push(discountType);
    }
    if (search) {
      baseConditions.push(`(
        CONCAT_WS(' ', l.fname, l.lname) LIKE ?
        OR l.email LIKE ?
        OR o.opportunityName LIKE ?
        OR e_req.name LIKE ?
      )`);
      baseReplacements.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Visibility: CEO sees every request, Branch Manager sees their own
    // branch's, everyone else (a counselor requesting their own discounts)
    // sees only requests they personally made - this page is reachable by
    // any sales.update holder, which is most sales staff, not just approvers.
    if (!isCeo(requester)) {
      if (isBranchManagerOrCeo(requester)) {
        baseConditions.push('COALESCE(l.branch, o.branchId) = ?');
        baseReplacements.push(Number((requester as any).branch || 0));
      } else {
        baseConditions.push('da.requestedBy = ?');
        baseReplacements.push(Number((requester as any).id));
      }
    }

    const conditions = [...baseConditions];
    const replacements = [...baseReplacements];
    if (status) {
      conditions.push('da.status = ?');
      replacements.push(status);
    }

    const baseWhereClause = baseConditions.length > 0 ? `WHERE ${baseConditions.join(' AND ')}` : '';
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const fromJoin = `
      FROM crm_discount_approvals da
      LEFT JOIN crm_forum_leads l ON da.leadId = l.id
      LEFT JOIN crm_opportunities o ON da.opportunityId = o.id
      LEFT JOIN crm_employee e_req ON da.requestedBy = e_req.id
      LEFT JOIN crm_employee e_app ON da.approvedBy = e_app.id`;

    const [discountApprovals] = await sequelize.query(`
      SELECT
        da.*,
        l.fname, l.lname, l.email, l.mobile,
        o.opportunityName, o.estimatedValue, o.currency,
        e_req.name as requestedEmployeeName,
        e_app.name as approvedEmployeeName,
        e_req.name as createdEmployeeName
      ${fromJoin}
      ${whereClause}
      ORDER BY da.createdAt DESC
      LIMIT ? OFFSET ?
    `, {
      replacements: [...replacements, limit, offset]
    });

    const [countRows] = await sequelize.query(`SELECT COUNT(*) AS total ${fromJoin} ${whereClause}`, { replacements });
    const total = Number((countRows as any[])[0]?.total || 0);

    const [statusCountRows] = await sequelize.query(`SELECT da.status, COUNT(*) AS count ${fromJoin} ${baseWhereClause} GROUP BY da.status`, { replacements: baseReplacements });
    const summary = { total: 0, pending: 0, approved: 0, rejected: 0 };
    (statusCountRows as Array<{ status: string; count: number }>).forEach((row) => {
      const count = Number(row.count);
      summary.total += count;
      if (row.status === 'pending' || row.status === 'approved' || row.status === 'rejected') {
        summary[row.status] = count;
      }
    });

    return NextResponse.json({
      success: true,
      data: discountApprovals,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary,
    });
  } catch (error: any) {
    console.error('Error fetching discount approvals:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch discount approvals: ' + error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const requester = getAuthenticatedUser(request);

    if (!requester) {
      return NextResponse.json(
        { success: false, error: 'You must be logged in to request a discount approval' },
        { status: 401 }
      );
    }
    const branchCurrency = await resolveBranchCurrency(requester.branch);
    if (!branchCurrency) {
      return NextResponse.json(
        { success: false, error: branchCurrencyError(requester.branch) },
        { status: 422 }
      );
    }

    // The client sends all three of originalAmount/discountAmount/discountedAmount
    // separately — without re-deriving them server-side, a caller can submit an
    // internally-inconsistent set (e.g. discountAmount > originalAmount) that,
    // once approved, gets written straight into crm_forum_leads.payTotal as a
    // negative balance (see PUT below).
    const originalAmount = Number(body.originalAmount);
    const discountAmount = Number(body.discountAmount);
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      return NextResponse.json({ success: false, error: 'originalAmount must be greater than zero' }, { status: 422 });
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > originalAmount) {
      return NextResponse.json({ success: false, error: 'discountAmount must be between zero and originalAmount' }, { status: 422 });
    }
    const discountedAmount = originalAmount - discountAmount;

    // Re-apply flow: correcting a wrong amount or a wrongly-approved/rejected
    // discount. The old row is validated (must belong to the same lead - a
    // guessed/unrelated id can't be superseded) and soft-deleted immediately,
    // before the new row is even created, so there's never a moment where
    // both the old and new entries read as "active" at once.
    let supersedesId: number | null = null;
    if (body.supersedesId) {
      const [oldRow] = await sequelize.query<{ id: number; leadId: number; is_deleted: number }>(
        `SELECT id, leadId, is_deleted FROM crm_discount_approvals WHERE id = ? LIMIT 1`,
        { replacements: [body.supersedesId], type: QueryTypes.SELECT },
      );
      if (!oldRow || Number(oldRow.leadId) !== Number(body.leadId)) {
        return NextResponse.json({ success: false, error: 'The discount request being replaced was not found for this lead.' }, { status: 404 });
      }
      if (oldRow.is_deleted) {
        return NextResponse.json({ success: false, error: 'That discount request was already replaced by another correction.' }, { status: 409 });
      }
      supersedesId = Number(body.supersedesId);
    }

    // Duplicate-submission guard: a resubmit of the same request would create
    // a second approval row (and, for an auto-approved 0-20% discount, apply
    // it a second time) - block an identical request for this lead within
    // the last minute.
    const [recentDuplicate] = await sequelize.query<{ id: number }>(
      `SELECT id FROM crm_discount_approvals
       WHERE leadId = ? AND (opportunityId <=> ?) AND requestedBy = ?
         AND discountAmount = ? AND originalAmount = ?
         AND createdAt >= (NOW() - INTERVAL 60 SECOND)
       LIMIT 1`,
      { replacements: [body.leadId, body.opportunityId || null, requester.id, discountAmount, originalAmount], type: QueryTypes.SELECT }
    );
    if (recentDuplicate) {
      return NextResponse.json(
        { success: false, error: 'This discount request was already submitted a moment ago.' },
        { status: 409 }
      );
    }

    // Tiered policy: 0-20% needs no approval at all (a counsellor can apply it
    // directly), 20-30% needs Branch Manager or CEO sign-off, 30-100% is CEO
    // only. The tier is always re-derived from discountAmount/originalAmount
    // (both stored below) rather than trusted from the client, so it can't be
    // spoofed and stays correct even if the tier boundaries change later.
    const thresholds = await getDiscountTierThresholds();
    const tier = getDiscountTier(discountAmount, originalAmount, thresholds);
    const isAutoApproved = tier === 'auto';
    const now = new Date();

    // Insert, the supersede of a corrected request and (for 0-20%) the amounts applied to the
    // lead/opportunity commit together, and the new id comes straight from the INSERT instead
    // of being searched for by reason text (which could match another request).
    const newDiscountId = await sequelize.transaction(async (transaction) => {
      const [insertedId] = await sequelize.query(`
        INSERT INTO crm_discount_approvals (
          leadId, opportunityId, discountType, discountAmount, originalAmount,
          discountedAmount, currency, reason, requestedBy, status,
          requestedDate, approvedBy, approvedAt, createdBy, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, {
        replacements: [
          body.leadId,
          body.opportunityId || null,
          body.discountType,
          discountAmount,
          originalAmount,
          discountedAmount,
          branchCurrency.currencyCode,
          body.reason,
          requester.id,
          isAutoApproved ? 'approved' : 'pending',
          now,
          isAutoApproved ? requester.id : null,
          isAutoApproved ? now : null,
          requester.id,
          now,
          now
        ],
        type: QueryTypes.INSERT,
        transaction,
      });
      const createdId = Number(insertedId || 0);

      if (supersedesId && createdId) {
        await sequelize.query(
          `UPDATE crm_discount_approvals SET is_deleted = 1, superseded_by = ?, updatedAt = ? WHERE id = ?`,
          { replacements: [createdId, now, supersedesId], transaction },
        );
      }

      // A 0-20% discount is applied immediately - the lead/opportunity value must
      // reflect it right away rather than waiting on an approval that will never come
      // (same effects the PUT handler applies on manual approval).
      if (isAutoApproved) {
        await sequelize.query(
          `UPDATE crm_forum_leads
           SET discount = ?, payTotal = ?, payBalance = GREATEST(? - COALESCE(paidYet, 0), 0)
           WHERE id = ?`,
          { replacements: [discountAmount, discountedAmount, discountedAmount, body.leadId], transaction }
        );
        if (body.opportunityId) {
          await sequelize.query(
            `UPDATE crm_opportunities
             SET estimatedValue = ?, actualValue = COALESCE(actualValue, ?), updatedAt = ?
             WHERE id = ? AND is_deleted = 0`,
            { replacements: [discountedAmount, discountedAmount, now, body.opportunityId], transaction }
          );
        }
      }
      return createdId;
    });

    // CEO/Director approve every discount regardless of branch, so notify
    // globally; Branch Manager only oversees their own branch's requests.
    const [leadRow] = await sequelize.query<{ fname: string; lname: string }>(
      `SELECT fname, lname FROM crm_forum_leads WHERE id = ? LIMIT 1`,
      { replacements: [body.leadId], type: QueryTypes.SELECT }
    );
    const clientName = leadRow ? `${leadRow.fname || ''} ${leadRow.lname || ''}`.trim() : `Lead #${body.leadId}`;
    const discountNotification = {
      // Auto-approved discounts (no sign-off needed) are informational; only a
      // genuine pending request is type 'discount_requested', which is what the
      // mobile app pushes to the CEO with [Approve]/[Reject] (lib/mobilePush.ts).
      type: isAutoApproved ? 'discount_auto_approved' : 'discount_requested',
      title: isAutoApproved ? `Discount auto-approved (0-${thresholds.autoMaxPercent}%)` : 'Discount approval requested',
      message: isAutoApproved
        ? `${clientName || `Lead #${body.leadId}`} received a ${discountAmount} ${branchCurrency.currencyCode} discount (${discountTierLabel(tier, thresholds)}) — no approval was required.`
        : `A ${discountAmount} ${branchCurrency.currencyCode} discount was requested for ${clientName || `Lead #${body.leadId}`} and needs ${discountTierLabel(tier, thresholds)} approval.`,
      priority: 'medium',
      link: isAutoApproved ? `/admin/leads/${body.leadId}/edit` : '/admin/discount-approvals',
      relatedId: body.leadId,
      relatedType: 'lead',
    };
    await Promise.all([
      notifyRole({ roleType: 'director', ...discountNotification }),
      notifyRole({ roleType: 'branch_manager', branchId: requester.branch, ...discountNotification }),
    ]);

    return NextResponse.json({
      success: true,
      message: isAutoApproved ? `Discount applied — no approval required (0-${thresholds.autoMaxPercent}%)` : 'Discount approval created successfully',
      data: { id: newDiscountId, status: isAutoApproved ? 'approved' : 'pending', tier }
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating discount approval:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create discount approval' },
      { status: 500 }
    );
  }
}
