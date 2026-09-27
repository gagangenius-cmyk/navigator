import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BalancesScreen } from '@/features/accounts/screens/BalancesScreen';
import { ConfirmDecisionScreen } from '@/features/approvals/screens/ConfirmDecisionScreen';
import { ChangePasswordScreen } from '@/features/auth/screens/ChangePasswordScreen';
import { AttendanceScreen } from '@/features/hr/screens/AttendanceScreen';
import { LeaveScreen } from '@/features/hr/screens/LeaveScreen';
import { PayslipsScreen } from '@/features/hr/screens/PayslipsScreen';
import { ItTicketsScreen } from '@/features/it-support/screens/ItTicketsScreen';
import { AppointmentsScreen } from '@/features/leads/screens/AppointmentsScreen';
import { FollowUpsScreen } from '@/features/leads/screens/FollowUpsScreen';
import { LeadDetailScreen } from '@/features/leads/screens/LeadDetailScreen';
import { LeadFormScreen } from '@/features/leads/screens/LeadFormScreen';
import { ClientsScreen } from '@/features/leads/screens/LeadListScreen';
import { LeadPoolScreen } from '@/features/leads/screens/LeadPoolScreen';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';
import { SettingsScreen } from '@/features/profile/screens/SettingsScreen';
import { useTheme } from '@/theme/ThemeProvider';
import { AppTabs } from './AppTabs';
import { withAccess } from './guards/ProtectedScreen';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

// Guarded once at module scope so each screen keeps a stable component identity.
const Screens = {
  LeadDetail: withAccess('LeadDetail', LeadDetailScreen),
  LeadForm: withAccess('LeadForm', LeadFormScreen),
  FollowUps: withAccess('FollowUps', FollowUpsScreen),
  Appointments: withAccess('Appointments', AppointmentsScreen),
  LeadPool: withAccess('LeadPool', LeadPoolScreen),
  Clients: withAccess('Clients', ClientsScreen),
  Balances: withAccess('Balances', BalancesScreen),
  ConfirmDecision: withAccess('ConfirmDecision', ConfirmDecisionScreen),
  Payslips: withAccess('Payslips', PayslipsScreen),
  ItTickets: withAccess('ItTickets', ItTicketsScreen),
};

export function AppStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Tabs" component={AppTabs} options={{ headerShown: false }} />
      <Stack.Screen name="LeadDetail" component={Screens.LeadDetail} options={{ title: 'Lead' }} />
      <Stack.Screen name="LeadForm" component={Screens.LeadForm} options={({ route }) => ({ title: route.params?.leadId ? 'Edit lead' : 'New lead' })} />
      <Stack.Screen name="FollowUps" component={Screens.FollowUps} options={{ title: 'Follow-ups' }} />
      <Stack.Screen name="Appointments" component={Screens.Appointments} options={{ title: 'Appointments' }} />
      <Stack.Screen name="LeadPool" component={Screens.LeadPool} options={{ title: 'Lead pool' }} />
      <Stack.Screen name="Clients" component={Screens.Clients} options={{ title: 'Clients' }} />
      <Stack.Screen name="Balances" component={Screens.Balances} options={{ title: 'Outstanding balances' }} />
      <Stack.Screen name="ConfirmDecision" component={Screens.ConfirmDecision} options={{ title: 'Confirm decision', presentation: 'modal' }} />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Attendance' }} />
      <Stack.Screen name="Leave" component={LeaveScreen} options={{ title: 'Leave' }} />
      <Stack.Screen name="Payslips" component={Screens.Payslips} options={{ title: 'Payslips' }} />
      <Stack.Screen name="ItTickets" component={Screens.ItTickets} options={{ title: 'IT support' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="ChangePassword" options={{ title: 'Change password' }}>
        {() => <ChangePasswordScreen />}
      </Stack.Screen>
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Stack.Navigator>
  );
}
