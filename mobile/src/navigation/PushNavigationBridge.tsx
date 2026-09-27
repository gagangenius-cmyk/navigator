import { useEffect } from 'react';
import { api } from '@/services/api/client';
import { selectStatus, selectUser, useSessionStore } from '@/store/sessionStore';
import { usePushStore } from '@/store/pushStore';
import { useUiStore } from '@/store/uiStore';
import { navigationRef } from './navigationRef';
import { openTarget } from './openTarget';

/**
 * Delivers a waiting notification destination once the app can act on it: signed in,
 * not behind the biometric lock, not stuck on a forced password change, and with the
 * navigator mounted. Until then the target simply waits in the push store.
 */
export function PushNavigationBridge({ navReady }: { navReady: boolean }) {
  const pending = usePushStore((s) => s.pending);
  const status = useSessionStore(selectStatus);
  const user = useSessionStore(selectUser);
  const locked = useUiStore((s) => s.locked);

  const ready = navReady && status === 'signedIn' && !locked && !user?.mustChangePassword && navigationRef.isReady();

  useEffect(() => {
    if (!pending || !ready) return;
    const item = usePushStore.getState().consume();
    if (!item) return;

    openTarget(item.target);
    // Opening it counts as reading it, so the bell badge doesn't keep the old count.
    if (item.notificationId) {
      const id = Number(item.notificationId);
      if (Number.isInteger(id)) {
        void api.put('/api/notifications', { notificationIds: [id], action: 'mark_read' }).catch(() => undefined);
      }
    }
  }, [pending, ready]);

  return null;
}
