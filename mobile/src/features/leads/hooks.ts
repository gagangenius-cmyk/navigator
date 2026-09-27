import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/constants/queryKeys';
import { isNetworkError } from '@/services/api/errors';
import { cacheGet, cacheSet } from '@/services/db/cache';
import { useOfflineQuery } from '@/services/db/useOfflineQuery';
import { withOfflineCache } from '@/services/db/offline';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import {
  addRemark,
  changeLeadStatus,
  claimLead,
  createFollowUp,
  fetchAppointments,
  fetchFollowUps,
  fetchLead,
  fetchLeadActivity,
  fetchLeadPool,
  fetchLeads,
  fetchLeadStatuses,
  actOnFollowUp,
  type AppointmentFilter,
  type CreateFollowUpInput,
  type FollowUpFilter,
} from './api';
import type { LeadFilters } from './types';

export function useLeadStatuses() {
  return useQuery({
    queryKey: queryKeys.leadStatuses,
    queryFn: async () => {
      // The status list rarely changes: serve the saved copy if the network is down.
      try {
        const data = await fetchLeadStatuses();
        void cacheSet('lead-statuses', data);
        return data;
      } catch (error) {
        if (isNetworkError(error)) {
          const hit = await cacheGet<Awaited<ReturnType<typeof fetchLeadStatuses>>>('lead-statuses');
          if (hit) return hit.data;
        }
        throw error;
      }
    },
    staleTime: 10 * 60_000,
  });
}

/**
 * Paged lead list. Only page 1 is mirrored to the offline cache: enough to browse the
 * latest leads with no connection without storing the whole book on the phone.
 */
export function useLeadList(filters: LeadFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.leadList(filters),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      withOfflineCache(`leads:${JSON.stringify(filters)}:${pageParam}`, () => fetchLeads(filters, pageParam), { cache: pageParam === 1 }),
    getNextPageParam: (last) => (last.data.page < last.data.totalPages ? last.data.page + 1 : undefined),
    meta: { persist: true },
  });
}

export function useLead(id: number, enabled = true) {
  return useOfflineQuery({
    queryKey: queryKeys.leadDetail(id),
    cacheKey: `lead:${id}`,
    queryFn: () => fetchLead(id),
    enabled,
  });
}

export function useLeadActivity(id: number) {
  return useOfflineQuery({
    queryKey: queryKeys.leadActivity(id),
    cacheKey: `lead-activity:${id}`,
    queryFn: () => fetchLeadActivity(id),
  });
}

export function useFollowUps(filter: FollowUpFilter) {
  return useOfflineQuery({
    queryKey: queryKeys.followUps(filter),
    cacheKey: `follow-ups:${filter}`,
    queryFn: () => fetchFollowUps(filter),
  });
}

export function useAppointments(filter: AppointmentFilter) {
  return useOfflineQuery({
    queryKey: queryKeys.appointments(filter),
    cacheKey: `appointments:${filter}`,
    queryFn: () => fetchAppointments(filter),
  });
}

export function useLeadPool(search: string) {
  return useOfflineQuery({
    queryKey: [...queryKeys.leadPool, search],
    cacheKey: `lead-pool:${search}`,
    queryFn: () => fetchLeadPool(1, search),
  });
}

// ---------- mutations ---------------------------------------------------

export function useChangeStatus(leadId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ status, notes }: { status: string; notes: string }) => changeLeadStatus(leadId, status, notes),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.leadDetail(leadId) });
      void client.invalidateQueries({ queryKey: queryKeys.leadActivity(leadId) });
      void client.invalidateQueries({ queryKey: queryKeys.leads });
    },
  });
}

export function useAddRemark(leadId: number) {
  const client = useQueryClient();
  const user = useSessionStore(selectUser);
  return useMutation({
    mutationFn: (remark: string) => addRemark(leadId, remark, user?.id ?? 0),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.leadActivity(leadId) });
      void client.invalidateQueries({ queryKey: queryKeys.leadDetail(leadId) });
    },
  });
}

export function useCreateFollowUp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFollowUpInput) => createFollowUp(input),
    onSuccess: (_data, input) => {
      void client.invalidateQueries({ queryKey: queryKeys.leadActivity(input.leadId) });
      void client.invalidateQueries({ queryKey: ['follow-ups'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useFollowUpAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, notes }: { id: number; action: 'complete' | 'cancel'; notes?: string }) => actOnFollowUp(id, action, notes),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['follow-ups'] });
      void client.invalidateQueries({ queryKey: queryKeys.leads });
    },
  });
}

export function useClaimLead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (leadId: number) => claimLead(leadId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.leadPool });
      void client.invalidateQueries({ queryKey: queryKeys.leads });
    },
  });
}
