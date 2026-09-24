import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { View } from 'react-native';
import { Avatar, Button, Card, Divider, ErrorState, ListRow, LoadingView, Screen, Text } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import type { AppStackParamList } from '@/navigation/types';
import { api } from '@/services/api/client';
import { useOfflineQuery } from '@/services/db/useOfflineQuery';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate } from '@/utils/format';

interface Profile {
  id: number;
  name: string;
  email: string | null;
  cemail: string | null;
  mobile: string | null;
  cmobile: string | null;
  nationality: string | null;
  doj: string | null;
  work_location: string | null;
  roleName: string | null;
  branchName: string | null;
  regionName: string | null;
  departmentName: string | null;
  managerName: string | null;
  managerRoleName: string | null;
}

const fetchProfile = async () => (await api.get<{ profile: Profile }>('/api/profile')).profile;

export function ProfileScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const { spacing } = useTheme();
  const query = useOfflineQuery({ queryKey: queryKeys.profile, cacheKey: 'profile', queryFn: fetchProfile });

  if (query.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (!query.data) {
    return (
      <Screen>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const p = query.data.data;
  const rows: [string, string | null][] = [
    ['Role', p.roleName],
    ['Department', p.departmentName],
    ['Branch', p.branchName],
    ['Region', p.regionName],
    ['Reports to', p.managerName ? `${p.managerName}${p.managerRoleName ? ` (${p.managerRoleName})` : ''}` : null],
    ['Email', p.cemail || p.email],
    ['Mobile', p.mobile || p.cmobile],
    ['Nationality', p.nationality],
    ['Joined', p.doj ? formatDate(p.doj) : null],
    ['Work location', p.work_location],
  ];

  return (
    <Screen scroll refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <Avatar name={p.name} size={72} />
        <Text variant="title" style={{ marginTop: spacing.md }}>
          {p.name}
        </Text>
      </View>

      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        {rows
          .filter(([, value]) => !!value)
          .map(([label, value], index) => (
            <View key={label}>
              {index > 0 ? <Divider /> : null}
              <ListRow title={value as string} subtitle={label} />
            </View>
          ))}
      </Card>

      <View style={{ marginTop: spacing.lg }}>
        <Button title="Change password" icon="key" variant="secondary" onPress={() => navigation.navigate('ChangePassword')} fullWidth />
      </View>
      <Text variant="caption" tone="muted" align="center" style={{ marginTop: spacing.lg }}>
        Personal details are managed by HR.
      </Text>
    </Screen>
  );
}
