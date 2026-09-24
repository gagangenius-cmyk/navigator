import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { queryClient } from '@/app/queryClient';
import { queryKeys } from '@/constants/queryKeys';
import { canSeeApprovals } from '@/features/auth/rbac';
import { selectStatus, selectUser, useSessionStore } from '@/store/sessionStore';
import { usePushStore } from '@/store/pushStore';
import { registerNotificationCategories } from './categories';
import { ensureChannels } from './channels';
import { getPushPermission, registerDeviceToken, requestPushPermission } from './registerDevice';
import { resolveNotificationRoute } from './router';
import { parsePushData } from './types';

// Wires the OS notification system to the app for as long as someone is signed in:
//   1. on sign-in: channels + role-appropriate action buttons + permission + token registration
//   2. a push arriving in the foreground: refresh whatever screens show that data
//   3. a tap / action-button press (warm or cold start): resolve it to a destination
//      and hand it to the navigation bridge via the push store
export function usePushNotifications(): void {
  const status = useSessionStore(selectStatus);
  const user = useSessionStore(selectUser);
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);

  const userId = user?.id;
  const approvals = canSeeApprovals(user);

  // 1. Registration, once per sign-in (and again if the user's role changes).
  useEffect(() => {
    if (status !== 'signedIn' || !userId) return;
    let cancelled = false;

    (async () => {
      try {
        // Channels must exist before Android asks for permission.
        await ensureChannels();
        await registerNotificationCategories({ approvals });

        let permission = await getPushPermission();
        if (permission === 'undetermined') permission = await requestPushPermission();
        if (cancelled || permission !== 'granted') return;

        await registerDeviceToken();
      } catch (error) {
        // Push is an enhancement - never let a setup failure affect the app.
        if (__DEV__) console.warn('Push setup failed', error);
      }
    })();

    // FCM/APNs can rotate the token at any time.
    const tokenSub = Notifications.addPushTokenListener(() => {
      void registerDeviceToken();
    });
    return () => {
      cancelled = true;
      tokenSub.remove();
    };
  }, [status, userId, approvals]);

  // 2. A push landed while the app is open.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = parsePushData(notification.request.content.data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      if (!data) return;
      if (data.type === 'lead_assigned') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.leads });
        void queryClient.invalidateQueries({ queryKey: queryKeys.leadPool });
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      }
    });
    return () => sub.remove();
  }, []);

  // 3. A tap or button press. useLastNotificationResponse covers both a running app
  // and a cold start from a notification.
  useEffect(() => {
    if (!lastResponse || status !== 'signedIn') return;
    const responseId = `${lastResponse.notification.request.identifier}:${lastResponse.actionIdentifier}`;
    if (handledResponse.current === responseId) return;
    handledResponse.current = responseId;

    const data = parsePushData(lastResponse.notification.request.content.data);
    const target = data ? resolveNotificationRoute(data, useSessionStore.getState().user, lastResponse.actionIdentifier) : null;
    if (target) usePushStore.getState().setPending(target, data?.notificationId);

    void Notifications.clearLastNotificationResponseAsync();
  }, [lastResponse, status]);
}
