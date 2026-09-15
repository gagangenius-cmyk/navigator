import { useEffect, useState, useCallback } from 'react';

export interface LeadStatusOption {
  id: number;
  name: string;
  badge_class: string;
  kanban_accent_class: string;
  kanban_tint_class: string;
  uses_p_priority_scale: number;
  sort_order: number;
}

// Fetches the admin-configurable disposition status list (crm_lead_status)
// once per mount — every status dropdown, Kanban board, and badge color in
// the app should read from this instead of a hardcoded string list, so an
// admin can add/rename/reorder statuses (or move the P1-P4 priority scale
// onto a different status) with no code change.
export function useLeadStatuses() {
  const [statuses, setStatuses] = useState<LeadStatusOption[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/lead-statuses');
      const data = await res.json();
      setStatuses(data.data ?? []);
    } catch {
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const usesPriorityScale = useCallback(
    (statusName: string | null | undefined) =>
      !!statuses.find((s) => s.name === statusName)?.uses_p_priority_scale,
    [statuses],
  );

  const badgeClassFor = useCallback(
    (statusName: string | null | undefined) =>
      statuses.find((s) => s.name === statusName)?.badge_class || 'bg-gray-100 text-gray-800',
    [statuses],
  );

  return { statuses, loading, reload, usesPriorityScale, badgeClassFor };
}
