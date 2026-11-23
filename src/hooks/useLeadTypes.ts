import { useEffect, useState } from 'react';

export interface LeadTypeOption { id: number; name: string; description: string | null; sort_order: number }

// Enabled lead types (crm_lead_type) - every Lead Type dropdown reads this so an admin can
// add/rename/disable types from Configuration > Lead Types with no code change.
export function useLeadTypes() {
  const [leadTypes, setLeadTypes] = useState<LeadTypeOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/lead-types')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.data) setLeadTypes(j.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return leadTypes;
}
