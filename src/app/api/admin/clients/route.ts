import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { CrmClients } from '@/models';
import { createCrudHandlers } from '@/lib/apiCrud';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isBranchManagerOrCeo, isCeo } from '@/lib/roleChecks';

let dbReady = false;
const ensureDB = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

const handlers = createCrudHandlers({
  model: CrmClients,
  entityName: 'client',
  searchFields: ['first_name', 'last_name', 'email', 'city', 'nationality'],
  filters: {
    status: 'status',
    verification: 'verify',
  },
  defaults: (body) => ({
    created: body.created || new Date(),
    token_validity:
      body.token_validity || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  }),
  // crm_clients already has is_deleted (unused by any live read path today -
  // see the GET override below) - soft delete instead of physically
  // removing the row.
  softDeleteField: 'is_deleted',
});

type ClientListRow = {
  id: number;
  opportunityId: number | null;
  leadId: number;
  contractId: number | null;
  contractNumber: string | null;
  contractPayTotal: string | number | null;
  contractPaidYet: string | number | null;
  contractPayBalance: string | number | null;
  contractStatus: string | null;
  case_activated_at: Date | string | null;
  fname: string | null;
  lname: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  dob: Date | string | null;
  address: string | null;
  area: string | null;
  nationality: string | null;
  assignTo: number | null;
  branchName: string | null;
  branchAddress: string | null;
  branchEmail: string | null;
  branchMobile: string | null;
  branchLicenseNumber: string | null;
  branchVatGstPercent: number | null;
  branchAbbrv: string | null;
  currencyCode: string | null;
};

// A lead becomes a formal "Client" once BOTH accounts (finance) verification
// and compliance verification are approved on its workflow review — see
// crm_opportunity_workflow_reviews.finance_status / .compliance_status, set via
// src/app/api/opportunities/[id]/workflow/route.ts. The legacy crm_clients
// table is never populated by any live code path, so GET reads from the
// workflow review directly instead (POST/PUT/DELETE below are left against
// crm_clients since nothing in the app currently exercises them).
//
// Since a lead can now have multiple contracts (each its own opportunity +
// workflow review), this deliberately returns ONE ROW PER APPROVED
// OPPORTUNITY, not one row per lead — a lead with two won+approved contracts
// shows as two rows here (grouped by leadId on the frontend). opportunity_id
// is already UNIQUE on crm_opportunity_workflow_reviews, so no MAX(id)/
// GROUP BY collapse is needed (or correct) any more.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['clients.view']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDB();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number.parseInt(searchParams.get('limit') || '200', 10), 500);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
    const offset = (page - 1) * limit;
    const search = searchParams.get('search') || '';

    const conditions = [
      `o.is_deleted = 0`,
      `w.finance_status = 'approved'`,
      `w.compliance_status = 'approved'`,
      `TRIM(LOWER(COALESCE(o.status, ''))) IN ('won', 'closed won', 'close won')`,
    ];
    const replacements: Record<string, unknown> = { limit, offset };
    if (search) {
      conditions.push(`(l.fname LIKE :search OR l.lname LIKE :search OR l.email LIKE :search)`);
      replacements.search = `%${search}%`;
    }
    // Branch Manager sees only their own branch's clients here - CEO and
    // every other clients.view holder (operations tier, finance, etc.) are
    // unaffected, matching the exemption pattern used across this app.
    // Scoped by the CONTRACT's own branch when one exists (a contract added
    // via the express flow can be at a different branch from the lead's home
    // branch), falling back to the lead's own branch for legacy won
    // opportunities that predate the contract model.
    if (isBranchManagerOrCeo(auth) && !isCeo(auth)) {
      conditions.push(`COALESCE(ct.branch_id, l.branch) = :userBranch`);
      replacements.userBranch = auth.branch || 0;
    }

    const fromAndWhere = `
       FROM crm_opportunity_workflow_reviews w
       JOIN crm_forum_leads l ON l.id = w.lead_id
       JOIN crm_opportunities o ON o.id = w.opportunity_id
       LEFT JOIN crm_contracts ct ON ct.opportunity_id = w.opportunity_id AND ct.is_deleted = 0
       LEFT JOIN crm_branch b ON b.id = COALESCE(ct.branch_id, l.branch)
       WHERE ${conditions.join(' AND ')}`;

    const [rows, [{ total }]] = await Promise.all([
      sequelize.query<ClientListRow>(
        `SELECT
           w.id, w.opportunity_id AS opportunityId, w.lead_id AS leadId, w.case_activated_at,
           ct.id AS contractId, ct.contract_number AS contractNumber, ct.pay_total AS contractPayTotal,
           ct.paid_yet AS contractPaidYet, ct.pay_balance AS contractPayBalance, ct.status AS contractStatus,
           l.fname, l.lname, l.email, l.phone, l.mobile, l.dob, l.address, l.area, l.nationality, l.assignTo,
           b.name AS branchName, b.address AS branchAddress, b.email AS branchEmail,
           b.mobile AS branchMobile, b.license_number AS branchLicenseNumber, b.vat_gst_percent AS branchVatGstPercent,
           b.abbrv AS branchAbbrv,
           (
             SELECT c.currency_code FROM crm_currency c
             WHERE c.status = 1
               AND LOWER(TRIM(c.country)) IN (
                 LOWER(TRIM(b.branch)), LOWER(TRIM(b.name)), LOWER(TRIM(b.abbrv)),
                 CASE
                   WHEN LOWER(CONCAT_WS(' ', b.name, b.branch, b.abbrv, b.address)) REGEXP 'dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain'
                     THEN 'united arab emirates'
                   ELSE ''
                 END
               )
             ORDER BY CASE
               WHEN LOWER(TRIM(c.country)) = LOWER(TRIM(b.branch)) THEN 1
               WHEN LOWER(TRIM(c.country)) = LOWER(TRIM(b.name)) THEN 2
               ELSE 3
             END
             LIMIT 1
           ) AS currencyCode
         ${fromAndWhere}
         ORDER BY w.case_activated_at DESC
         LIMIT :limit OFFSET :offset`,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query<{ total: number }>(
        `SELECT COUNT(*) AS total ${fromAndWhere}`,
        { replacements, type: QueryTypes.SELECT }
      ),
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      opportunityId: r.opportunityId,
      leadId: r.leadId,
      contractId: r.contractId,
      contractNumber: r.contractNumber,
      contractPayTotal: r.contractPayTotal,
      contractPaidYet: r.contractPaidYet,
      contractPayBalance: r.contractPayBalance,
      contractStatus: r.contractStatus,
      first_name: r.fname || '',
      last_name: r.lname || '',
      email: r.email || '',
      phone: r.mobile || r.phone || '',
      image: '',
      dob: r.dob || new Date(0),
      address: r.address || '',
      full_address: r.address || '',
      token: '',
      token_validity: r.case_activated_at || new Date(0),
      verify: 1,
      password: '',
      hash_password: '',
      status: 1,
      accept: 1,
      created: r.case_activated_at || new Date(0),
      case_manager: r.assignTo || 0,
      backend_person: r.assignTo || 0,
      is_deleted: 0,
      city: r.area || '',
      nationality: r.nationality || '',
      branchName: r.branchName || '',
      branchAddress: r.branchAddress || '',
      branchEmail: r.branchEmail || '',
      branchMobile: r.branchMobile || '',
      branchLicenseNumber: r.branchLicenseNumber || null,
      branchVatGstPercent: r.branchVatGstPercent ?? null,
      branchAbbrv: r.branchAbbrv || null,
      currencyCode: r.currencyCode || 'AED',
    }));

    return NextResponse.json({ data, pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) } });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 });
  }
}

export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
