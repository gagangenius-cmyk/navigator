import { buildLeadRenderValues } from '@/lib/templateRenderContext';
import { resolveContextForLeads } from '@/lib/broadcastContext';

/**
 * Templates stored in the database use two token styles: the namespaced {{lead.first_name}} /
 * {{employee.name}} set (Templates page) and the flat {{first_name}} / {{counselor_name}} /
 * {{appointment_date}} set the starter templates and Broadcast campaigns use. Both resolve here,
 * so every stored template renders no matter which style its author used.
 */
export function withFlatAliases(base: Record<string, string>, context: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: string | undefined) => { if (value) out[key] = value; };

  put('first_name', base['lead.first_name']);
  put('last_name', base['lead.last_name']);
  put('full_name', base['lead.full_name']);
  put('email', base['lead.email']);
  put('phone', base['lead.mobile']);
  put('mobile', base['lead.mobile']);
  put('service', base['lead.service']);
  put('country', base['lead.country']);
  // Appointment / payment context first; the person sending is the fallback counsellor.
  put('counselor_name', context.counselor_name || base['employee.name']);
  put('counselor_email', context.counselor_email || base['employee.email']);
  put('counselor_phone', context.counselor_phone || base['employee.phone']);
  put('branch_name', context.branch_name || base['branch.name']);
  put('branch_address', context.branch_address || base['branch.address']);
  put('branch_phone', context.branch_phone || base['branch.phone']);
  for (const key of ['appointment_date', 'appointment_time', 'balance_due', 'due_date']) put(key, context[key]);

  // Namespaced values always win over an alias with the same key.
  return { ...out, ...base };
}

export async function buildSendValues(leadId: number, senderEmployeeId: number): Promise<Record<string, string>> {
  const [base, contexts] = await Promise.all([
    buildLeadRenderValues(leadId, senderEmployeeId),
    resolveContextForLeads([leadId]),
  ]);
  return withFlatAliases(base, (contexts.get(leadId) ?? {}) as Record<string, string | undefined>);
}
