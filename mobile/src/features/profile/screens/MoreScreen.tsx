import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Alert, View } from 'react-native';
import { Avatar, Card, Divider, ListRow, Screen, SectionHeader, Text, type IconName } from '@/components';
import { canAccess } from '@/navigation/routeAccess';
import type { AppStackParamList, RouteName } from '@/navigation/types';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { useTheme } from '@/theme/ThemeProvider';

interface MenuItem {
  route: keyof AppStackParamList;
  access: RouteName;
  icon: IconName;
  title: string;
  subtitle?: string;
}

const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Work',
    items: [
      { route: 'FollowUps', access: 'FollowUps', icon: 'alarm', title: 'Follow-ups', subtitle: 'Calls and tasks you scheduled' },
      { route: 'Appointments', access: 'Appointments', icon: 'calendar', title: 'Appointments', subtitle: 'Client meetings' },
      { route: 'LeadPool', access: 'LeadPool', icon: 'water', title: 'Lead pool', subtitle: 'Unassigned leads waiting for an owner' },
      { route: 'Clients', access: 'Clients', icon: 'ribbon', title: 'Clients' },
      { route: 'Balances', access: 'Balances', icon: 'wallet', title: 'Outstanding balances' },
    ],
  },
  {
    title: 'Me at work',
    items: [
      { route: 'Attendance', access: 'Attendance', icon: 'time', title: 'Attendance', subtitle: 'Clock in, breaks, history' },
      { route: 'Leave', access: 'Leave', icon: 'airplane', title: 'Leave' },
      { route: 'Payslips', access: 'Payslips', icon: 'document-text', title: 'Payslips' },
      { route: 'ItTickets', access: 'ItTickets', icon: 'hardware-chip', title: 'IT support' },
    ],
  },
  {
    title: 'Account',
    items: [
      { route: 'Profile', access: 'Profile', icon: 'person-circle', title: 'Profile' },
      { route: 'Settings', access: 'Settings', icon: 'settings', title: 'Settings', subtitle: 'Appearance, security, notifications' },
    ],
  },
];

export function MoreScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const user = useSessionStore(selectUser);
  const signOut = useSessionStore((s) => s.signOut);
  const { spacing } = useTheme();

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'Saved data on this phone will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <Screen scroll>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={user?.name ?? '?'} size={52} />
          <View style={{ flex: 1 }}>
            <Text variant="heading" numberOfLines={1}>
              {user?.name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {user?.roleName} · {user?.email}
            </Text>
          </View>
        </View>
      </Card>

      {SECTIONS.map((section) => {
        const items = section.items.filter((item) => canAccess(item.access, user));
        if (!items.length) return null;
        return (
          <View key={section.title}>
            <SectionHeader title={section.title} />
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              {items.map((item, index) => (
                <View key={item.route}>
                  {index > 0 ? <Divider /> : null}
                  <ListRow title={item.title} subtitle={item.subtitle} icon={item.icon} onPress={() => navigation.navigate(item.route as 'Profile')} />
                </View>
              ))}
            </Card>
          </View>
        );
      })}

      <View style={{ marginTop: spacing.lg }}>
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <ListRow title="Sign out" icon="log-out" destructive onPress={confirmSignOut} chevron={false} />
        </Card>
      </View>
    </Screen>
  );
}
