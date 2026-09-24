import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useApprovalCounts } from '@/features/approvals/hooks';
import { ApprovalDashboardScreen } from '@/features/approvals/screens/ApprovalDashboardScreen';
import { DashboardScreen } from '@/features/dashboard/screens/DashboardScreen';
import { LeadsTabScreen } from '@/features/leads/screens/LeadListScreen';
import { useAppBadge, useUnreadCount } from '@/features/notifications/hooks';
import { NotificationsScreen } from '@/features/notifications/screens/NotificationsScreen';
import { MoreScreen } from '@/features/profile/screens/MoreScreen';
import { Icon, type IconName } from '@/components';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { useTheme } from '@/theme/ThemeProvider';
import { withAccess } from './guards/ProtectedScreen';
import { canAccess } from './routeAccess';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

const ICONS: Record<keyof TabParamList, [IconName, IconName]> = {
  Home: ['home', 'home-outline'],
  Leads: ['people', 'people-outline'],
  Approvals: ['shield-checkmark', 'shield-checkmark-outline'],
  Notifications: ['notifications', 'notifications-outline'],
  More: ['menu', 'menu-outline'],
};

const GuardedLeads = withAccess('Leads', LeadsTabScreen);
const GuardedApprovals = withAccess('Approvals', ApprovalDashboardScreen);

/** The bottom tab bar. Tabs are derived from the user's permissions, so nobody sees a tab they cannot use. */
export function AppTabs() {
  const user = useSessionStore(selectUser);
  const { colors } = useTheme();
  const unread = useUnreadCount();
  const approvals = useApprovalCounts();
  useAppBadge();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.border },
        tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.onDanger },
        tabBarIcon: ({ focused, color, size }) => <Icon name={ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={DashboardScreen} options={{ title: 'Home' }} />
      {canAccess('Leads', user) ? <Tab.Screen name="Leads" component={GuardedLeads} options={{ title: 'Leads' }} /> : null}
      {canAccess('Approvals', user) ? (
        <Tab.Screen name="Approvals" component={GuardedApprovals} options={{ title: 'Approvals', tabBarBadge: approvals.total || undefined }} />
      ) : null}
      <Tab.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Alerts', tabBarBadge: unread || undefined }} />
      <Tab.Screen name="More" component={MoreScreen} options={{ title: 'More' }} />
    </Tab.Navigator>
  );
}
