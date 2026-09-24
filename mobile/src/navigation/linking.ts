import type { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import type { AppStackParamList } from './types';

// URL deep links (navigatorcrm://...), e.g. from an email or the web CRM.
// Push-notification taps use the push router instead (services/push/router.ts) because
// they carry role checks and action buttons; both end at the same screens, and every
// gated screen is wrapped in withAccess(), so a link can never bypass RBAC.
export const linking: LinkingOptions<AppStackParamList> = {
  prefixes: [Linking.createURL('/'), 'navigatorcrm://'],
  config: {
    screens: {
      Tabs: {
        screens: {
          Home: 'home',
          Leads: 'leads',
          Approvals: 'approvals/:segment?',
          Notifications: 'notifications',
          More: 'more',
        },
      },
      LeadDetail: { path: 'lead/:leadId', parse: { leadId: Number } },
      FollowUps: 'follow-ups',
      Appointments: 'appointments',
      LeadPool: 'lead-pool',
    },
  },
};
