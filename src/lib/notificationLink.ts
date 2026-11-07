// Where clicking a notification must land. Decided in ONE place from what the notification is about, not
// from whatever `link` the code that created it happened to store: most payment / compliance / discount
// notifications were stored with a lead-edit link even though the person receiving them acts somewhere
// else (Accounts must open Payment Verification, compliance must open Compliance Approvals ...), and an
// 'opportunity' notification built opportunity-flow?leadId=<opportunity id>.

export interface NotificationLinkInput {
  type?: string | null;
  link?: string | null;
  relatedId?: number | string | null;
  relatedType?: string | null;
}

/** The lead a notification is about, if it names one (related lead, else a /admin/leads/:id link). */
export function leadIdOf(n: NotificationLinkInput): number | null {
  if (n.relatedType === 'lead' && Number(n.relatedId) > 0) return Number(n.relatedId);
  const fromLink = String(n.link || '').match(/^\/admin\/leads\/(\d+)(?:\/|\?|$)/);
  return fromLink ? Number(fromLink[1]) : null;
}

const leadEdit = (id: number) => `/admin/leads/${id}/edit`;
const flow = (id: number) => `/admin/leads/opportunity-flow?leadId=${id}`;

export function resolveNotificationLink(n: NotificationLinkInput): string | null {
  const type = String(n.type || '');
  const leadId = leadIdOf(n);

  switch (type) {
    // Accounts / CEO must verify it.
    case 'payment_submission':
      return '/admin/finance/payment-verification';
    // The counselor's next step is the opportunity flow (compliance / documents) for that lead.
    case 'payment_verification':
    case 'compliance_review':
      return leadId ? flow(leadId) : n.link || null;
    // The compliance reviewer's queue.
    case 'compliance_submission':
      return '/admin/compliance-approvals';
    case 'discount_requested':
    case 'discount_approval':
      return '/admin/discount-approvals';
    case 'appointment':
    case 'meeting':
    case 'appointment_cross_branch':
    case 'appointment_acknowledged':
      // A meeting tied to a lead opens that lead; otherwise the appointments list.
      return type === 'meeting' && leadId ? leadEdit(leadId) : '/admin/appointments';
    case 'contract_receipt_recorded':
    case 'contract_reconciliation_drift':
      return '/admin/contracts';
    case 'renewal_alert':
      return '/admin/pro-works/renewal-reminders';
    case 'leave_approval':
      return '/admin/hr/leave-management';
    case 'payroll_completion':
      return '/admin/hr/payroll-management';
    // Everything else that is about one lead opens that lead: assignment, follow-ups, new lead, contract
    // created, discount outcome, client uploads...
    case 'lead_assigned':
    case 'lead_updated':
    case 'lead':
    case 'followup':
    case 'contract_created':
    case 'discount_reviewed':
    case 'discount_auto_approved':
    case 'system':
      if (leadId) return leadEdit(leadId);
      break;
    default:
      break;
  }

  // Unknown type: trust what the creator stored, repairing the old bare /admin/leads/:id (no such page).
  if (n.link) {
    const bare = n.link.match(/^\/admin\/leads\/(\d+)\/?$/);
    return bare ? leadEdit(Number(bare[1])) : n.link;
  }
  if (leadId) return leadEdit(leadId);
  switch (n.relatedType) {
    case 'discount_approval': return '/admin/discount-approvals';
    case 'reassignment': return '/admin/reassignment';
    case 'contract': return '/admin/contracts';
    case 'appointment': return '/admin/appointments';
    default: return null;
  }
}
