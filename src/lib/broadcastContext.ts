import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import { resolveBranchCurrency } from './branchCurrency';

// Per-recipient context variables for appointment / follow-up / payment
// templates, resolved once at launch (the values are frozen into
// crm_broadcast_recipients.rendered_variables, like the lead fields).

export { CONTEXT_VARIABLE_KEYS, type ContextVariableKey } from './broadcastContextKeys';
import type { ContextVariableKey } from './broadcastContextKeys';

const formatDate = (value: unknown): string | null => {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

const formatTime = (value: unknown): string | null => {
  const text = String(value || '').trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(text);
  if (!match) return text || null;
  const hours = Number(match[1]);
  return `${((hours + 11) % 12) + 1}:${match[2]} ${hours >= 12 ? 'PM' : 'AM'}`;
};

export async function resolveContextForLeads(leadIds: number[]): Promise<Map<number, Partial<Record<ContextVariableKey, string>>>> {
  const result = new Map<number, Partial<Record<ContextVariableKey, string>>>();
  if (!leadIds.length) return result;

  const leads = await sequelize.query<any>(
    `SELECT l.id, l.payBalance, l.dueDate, l.branch AS leadBranch,
            e.name AS counselorName, e.mobile AS counselorPhone, COALESCE(e.cemail, e.email) AS counselorEmail,
            COALESCE(b.name, b.branch) AS branchName, b.address AS branchAddress, b.mobile AS branchPhone
     FROM crm_forum_leads l
     LEFT JOIN crm_employee e ON e.id = COALESCE(NULLIF(l.Counsilor, 0), l.assignTo)
     LEFT JOIN crm_branch b ON b.id = l.branch
     WHERE l.id IN (:leadIds)`,
    { replacements: { leadIds }, type: QueryTypes.SELECT },
  );

  // Next upcoming, not-yet-done appointment per lead.
  const appointments = await sequelize.query<any>(
    `SELECT a.leadid, a.date, a.appointtime, e.name AS counselorName, e.mobile AS counselorPhone
     FROM appointments a
     LEFT JOIN crm_employee e ON e.id = a.counsilorid
     WHERE a.leadid IN (:leadIds) AND a.date >= CURDATE() AND COALESCE(a.done, 0) = 0 AND COALESCE(a.not_done, 0) = 0
     ORDER BY a.date ASC, a.appointtime ASC`,
    { replacements: { leadIds }, type: QueryTypes.SELECT },
  ).catch(() => [] as any[]);
  const nextByLead = new Map<number, any>();
  for (const a of appointments) if (!nextByLead.has(a.leadid)) nextByLead.set(a.leadid, a);

  const currencyByBranch = new Map<number, string>();
  for (const lead of leads) {
    const values: Partial<Record<ContextVariableKey, string>> = {};
    const appt = nextByLead.get(lead.id);
    const set = (key: ContextVariableKey, value: string | null | undefined) => { if (value) values[key] = value; };

    set('appointment_date', formatDate(appt?.date));
    set('appointment_time', formatTime(appt?.appointtime));
    // The appointment's own counselor wins over the lead's general owner.
    set('counselor_name', appt?.counselorName || lead.counselorName);
    set('counselor_phone', appt?.counselorPhone || lead.counselorPhone);
    set('counselor_email', lead.counselorEmail);
    set('branch_name', lead.branchName);
    set('branch_address', lead.branchAddress);
    set('branch_phone', lead.branchPhone);
    set('due_date', formatDate(lead.dueDate));

    const balance = Number(lead.payBalance || 0);
    if (balance > 0) {
      let currency = lead.leadBranch ? currencyByBranch.get(lead.leadBranch) : undefined;
      if (!currency && lead.leadBranch) {
        currency = (await resolveBranchCurrency(lead.leadBranch))?.currencyCode;
        if (currency) currencyByBranch.set(lead.leadBranch, currency);
      }
      set('balance_due', `${currency || ''} ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim());
    }
    result.set(lead.id, values);
  }
  return result;
}
