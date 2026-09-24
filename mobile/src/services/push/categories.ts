import * as Notifications from 'expo-notifications';
import { CATEGORY_ACTIONS, categoriesForUser } from './categoryDefs';

/**
 * Registers the action-button sets the signed-in user can act on. Categories are
 * stored natively (iOS notification center / Android shared preferences), so the
 * buttons still appear on a notification delivered while the app is killed.
 * Role-aware: a counselor only gets the lead buttons, an approver gets all four.
 */
export async function registerNotificationCategories(flags: { approvals: boolean }): Promise<void> {
  const wanted = new Set(categoriesForUser(flags));

  await Promise.all(
    (Object.keys(CATEGORY_ACTIONS) as (keyof typeof CATEGORY_ACTIONS)[]).map(async (category) => {
      if (!wanted.has(category)) {
        // Drop a stale category left by a previous user of this phone.
        await Notifications.deleteNotificationCategoryAsync(category).catch(() => false);
        return;
      }
      await Notifications.setNotificationCategoryAsync(
        category,
        CATEGORY_ACTIONS[category].map((action) => ({
          identifier: action.identifier,
          buttonTitle: action.buttonTitle,
          options: {
            // Always foreground the app: the decision is confirmed in-app with biometrics.
            opensAppToForeground: true,
            isDestructive: action.destructive ?? false,
            isAuthenticationRequired: action.requiresUnlock ?? false,
          },
        })),
      );
    }),
  );
}
