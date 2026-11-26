// Names shown in a lead's activity log for crm_remarks.action values (client-safe: no server imports).
const LABELS: Record<string, string> = {
  remark_added: 'Lead Remark',
  remark_edited: 'Lead Remark (edited)',
};

export function activityLabel(action: string | null | undefined): string {
  const key = String(action || '');
  return LABELS[key] || key.replace(/_/g, ' ');
}
