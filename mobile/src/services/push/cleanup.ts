import * as Notifications from 'expo-notifications';

/** Clears delivered notifications from the tray on sign-out (they can contain client names). */
export async function clearDeliveredNotifications(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  await Notifications.setBadgeCountAsync(0).catch(() => false);
}
