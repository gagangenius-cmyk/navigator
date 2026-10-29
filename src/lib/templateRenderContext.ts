import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';

// Namespaced merge fields for rendering a template for ONE lead on behalf of
// the logged-in employee: {{lead.*}}, {{employee.*}}, {{branch.*}}, {{company.*}}.
// Missing values are simply omitted so the caller decides whether to fall back
// or report them (renderTemplateText throws on missing tokens).
export const TEMPLATE_NAMESPACES = {
  lead: ['first_name', 'last_name', 'full_name', 'email', 'mobile', 'status', 'service', 'country', 'source'],
  employee: ['name', 'email', 'phone', 'signature'],
  branch: ['name', 'address', 'phone', 'email'],
  company: ['name', 'website'],
} as const;

export async function buildLeadRenderValues(leadId: number, employeeId: number): Promise<Record<string, string>> {
  const [lead] = await sequelize.query<any>(
    `SELECT l.fname, l.lname, l.email, l.mobile, l.status, l.market_source,
            COALESCE(s.name, pt.type, l.service_interest) AS service,
            COALESCE(cp.name, l.country_interest) AS country,
            b.name AS branchLegalName, b.branch AS branchName, b.address AS branchAddress,
            b.mobile AS branchPhone, b.email AS branchEmail
     FROM crm_forum_leads l
     LEFT JOIN crm_country_proces cp ON cp.id = CAST(l.country_interest AS UNSIGNED)
     LEFT JOIN crm_service s ON s.id = CAST(l.service_interest AS UNSIGNED)
     LEFT JOIN crm_program_type pt ON pt.id = CAST(l.service_interest AS UNSIGNED)
     LEFT JOIN crm_branch b ON b.id = l.branch
     WHERE l.id = :leadId LIMIT 1`,
    { replacements: { leadId }, type: QueryTypes.SELECT }
  );
  if (!lead) return {};

  const [employee] = await sequelize.query<any>(
    `SELECT e.name, COALESCE(NULLIF(e.cemail, ''), e.email) AS email,
            COALESCE(NULLIF(e.cmobile, ''), e.mobile) AS phone, m.signature
     FROM crm_employee e
     LEFT JOIN crm_employee_mailboxes m ON m.employee_id = e.id
     WHERE e.id = :employeeId LIMIT 1`,
    { replacements: { employeeId }, type: QueryTypes.SELECT }
  ).catch(() => [] as any[]);

  const values: Record<string, string> = {};
  const set = (key: string, value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value).trim();
    if (text) values[key] = text;
  };

  set('lead.first_name', lead.fname);
  set('lead.last_name', lead.lname);
  set('lead.full_name', [lead.fname, lead.lname].filter(Boolean).join(' '));
  set('lead.email', lead.email);
  set('lead.mobile', lead.mobile);
  set('lead.status', lead.status);
  set('lead.service', lead.service);
  set('lead.country', lead.country);
  set('lead.source', lead.market_source);

  set('employee.name', employee?.name);
  set('employee.email', employee?.email);
  set('employee.phone', employee?.phone);
  set('employee.signature', employee?.signature);

  set('branch.name', lead.branchLegalName || lead.branchName);
  set('branch.address', lead.branchAddress);
  set('branch.phone', lead.branchPhone);
  set('branch.email', lead.branchEmail);

  set('company.name', process.env.COMPANY_NAME || lead.branchLegalName || 'Navigator');
  set('company.website', process.env.COMPANY_WEBSITE);

  return values;
}
