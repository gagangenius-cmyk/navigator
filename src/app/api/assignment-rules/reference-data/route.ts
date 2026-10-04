import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isCeo } from '@/lib/roleChecks';

// One-shot bundle of everything the Assignment Rules admin UI needs to
// populate its condition builder (branches, sources) and queue picker
// (active employees with their branch, for at-a-glance queue composition) -
// self-contained under the same CEO-only gate as the rest of this feature,
// rather than depending on branches.manage/employees.manage too.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['transfers.manage']);
  if (isAuthError(auth)) return auth;
  if (!isCeo(auth)) {
    return NextResponse.json({ success: false, error: 'Only the CEO can manage lead assignment rules' }, { status: 403 });
  }
  try {
    const [branches, sources, employees, statuses, campaignRows] = await Promise.all([
      sequelize.query('SELECT id, name, abbrv FROM crm_branch WHERE status = 1 ORDER BY name ASC', { type: QueryTypes.SELECT }),
      sequelize.query('SELECT id, name FROM crm_source WHERE status = 1 ORDER BY name ASC', { type: QueryTypes.SELECT }),
      sequelize.query(
        `SELECT e.id, e.name, e.branch, b.name AS branchName
         FROM crm_employee e
         LEFT JOIN crm_branch b ON b.id = e.branch
         WHERE e.status = 1
         ORDER BY e.name ASC`,
        { type: QueryTypes.SELECT }
      ),
      // Same canonical status list the Leads page's own filter reads
      // (crm_lead_status) - keeps the rule builder's Status condition in
      // sync with whatever statuses are actually enabled for the business.
      sequelize.query<{ name: string }>(
        'SELECT name FROM crm_lead_status WHERE is_enabled = 1 ORDER BY sort_order ASC, id ASC',
        { type: QueryTypes.SELECT }
      ),
      // Campaign is free text (crm_forum_leads.campaign has no fixed
      // vocabulary) - offered only as suggestions, never a closed list.
      sequelize.query<{ campaign: string }>(
        `SELECT DISTINCT campaign FROM crm_forum_leads WHERE campaign IS NOT NULL AND campaign <> '' ORDER BY campaign ASC LIMIT 200`,
        { type: QueryTypes.SELECT }
      ),
    ]);
    const campaigns = campaignRows.map((r) => r.campaign);
    return NextResponse.json({ success: true, branches, sources, employees, statuses: statuses.map((s) => s.name), campaigns });
  } catch (error) {
    console.error('Error fetching assignment-rule reference data:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch reference data' }, { status: 500 });
  }
}
