import { api } from '@/services/api/client';

/** A row of GET /api/notifications. */
export interface NotificationRow {
  id: number;
  type: string;
  title: string;
  message: string;
  priority: string;
  isRead: boolean;
  createdAt: string;
  relatedId: number | null;
  relatedType: string | null;
  link: string | null;
}

export interface NotificationsResponse {
  notifications: NotificationRow[];
  unreadCount: number;
}

export function fetchNotifications(limit = 50): Promise<NotificationsResponse> {
  return api.get<NotificationsResponse>('/api/notifications', { query: { limit } });
}

// The server now scopes these to the caller's own notifications (a fix made alongside
// the mobile app), so a wrong id is a no-op rather than touching someone else's row.
export function markNotifications(ids: number[], action: 'mark_read' | 'mark_unread'): Promise<unknown> {
  return api.put('/api/notifications', { notificationIds: ids, action });
}

export function deleteNotifications(ids: number[]): Promise<unknown> {
  return api.put('/api/notifications', { notificationIds: ids, action: 'delete' });
}
