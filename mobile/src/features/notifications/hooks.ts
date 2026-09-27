import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { queryKeys } from '@/constants/queryKeys';
import { useOfflineQuery } from '@/services/db/useOfflineQuery';
import { selectStatus, useSessionStore } from '@/store/sessionStore';
import { fetchNotifications, markNotifications } from './api';

/** Polls every 30s like the web bell; a push received in the foreground refreshes it at once. */
export function useNotifications() {
  const status = useSessionStore(selectStatus);
  return useOfflineQuery({
    queryKey: queryKeys.notifications,
    cacheKey: 'notifications',
    queryFn: () => fetchNotifications(50),
    enabled: status === 'signedIn',
    refetchInterval: 30_000,
  });
}

export function useUnreadCount(): number {
  return useNotifications().data?.data.unreadCount ?? 0;
}

/** Keeps the launcher-icon badge in step with the unread count. */
export function useAppBadge(): void {
  const unread = useUnreadCount();
  useEffect(() => {
    void Notifications.setBadgeCountAsync(unread).catch(() => false);
  }, [unread]);
}

export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => markNotifications(ids, 'mark_read'),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}
