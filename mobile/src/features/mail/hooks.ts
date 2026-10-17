import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/constants/queryKeys';
import { canAccess } from '@/navigation/routeAccess';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { fetchMail, fetchThread, mailAction, sendMail, syncMail } from './api';
import type { MailAction, MailFolder } from './types';

// Mail is deliberately NOT persisted to the offline cache (meta.persist is left
// off): message bodies are client PII and live on the server's mailbox anyway.

export function useMailList(folder: MailFolder, search: string, unreadOnly: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.mailList(folder, search, unreadOnly),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchMail(folder, pageParam, search, unreadOnly),
    getNextPageParam: (last) => (last.page.page < last.page.totalPages ? last.page.page + 1 : undefined),
  });
}

/** Unread inbox count for the tab badge; light single-row request, refreshed every 2 minutes. */
export function useMailUnread() {
  const user = useSessionStore(selectUser);
  const enabled = canAccess('Mail', user);
  const query = useQuery({
    queryKey: queryKeys.mailUnread,
    queryFn: async () => (await fetchMail('inbox', 1, '', true, 1)).counts.inbox_unread,
    enabled,
    refetchInterval: 120_000,
    retry: false,
  });
  return enabled ? query.data ?? 0 : 0;
}

export function useMailThread(id: number) {
  return useQuery({ queryKey: queryKeys.mailThread(id), queryFn: () => fetchThread(id) });
}

export function useMailAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: number[]; action: MailAction }) => mailAction(ids, action),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.mail }),
  });
}

export function useSyncMail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: syncMail,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.mail }),
  });
}

export function useSendMail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: sendMail,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.mail }),
  });
}
