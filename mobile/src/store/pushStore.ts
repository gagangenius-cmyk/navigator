import { create } from 'zustand';
import type { PushTarget } from '@/services/push/router';

// A notification tap can arrive when the app cannot navigate yet (cold start,
// still signing in, biometric lock showing). The destination waits here until
// the navigation bridge can act on it - it is never lost, and never acted on
// for a signed-out user.
interface PushState {
  pending: PushTarget | null;
  /** id of the crm_notifications row to mark read once the target opens. */
  pendingNotificationId: string | null;
  setPending: (target: PushTarget, notificationId?: string) => void;
  consume: () => { target: PushTarget; notificationId: string | null } | null;
  clear: () => void;
}

export const usePushStore = create<PushState>((set, get) => ({
  pending: null,
  pendingNotificationId: null,
  setPending: (pending, notificationId) => set({ pending, pendingNotificationId: notificationId ?? null }),
  consume: () => {
    const { pending, pendingNotificationId } = get();
    if (!pending) return null;
    set({ pending: null, pendingNotificationId: null });
    return { target: pending, notificationId: pendingNotificationId };
  },
  clear: () => set({ pending: null, pendingNotificationId: null }),
}));
