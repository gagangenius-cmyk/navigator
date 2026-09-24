import * as Notifications from 'expo-notifications';
import { useSessionStore } from '@/store/sessionStore';
import { canReceivePush } from './policy';
import { parsePushData } from './types';

/**
 * Foreground presentation. By default a notification that arrives while the app is
 * open is silently dropped; this makes it show as a banner (heads-up on Android),
 * play the sound and update the badge - but only if the signed-in user is meant to
 * see it (see policy.ts). Non-CRM notifications are shown as normal.
 *
 * Must run once, early (module scope in App), before any notification can arrive.
 */
export function configureForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = parsePushData(notification.request.content.data);
      const show = data ? canReceivePush(data.type, useSessionStore.getState().user) : true;
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: true,
      };
    },
  });
}
