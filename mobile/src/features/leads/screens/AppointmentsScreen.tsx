import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Badge, Button, CachedBanner, Card, Chip, EmptyState, ErrorState, LoadingView, Screen, Text } from '@/components';
import type { AppStackParamList } from '@/navigation/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate, formatTime, fullName } from '@/utils/format';
import { callPhone } from '@/utils/phone';
import type { AppointmentFilter } from '../api';
import { useAppointments } from '../hooks';

const FILTERS: { value: AppointmentFilter; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'today', label: 'Today' },
  { value: 'done', label: 'Done' },
];

/** Read-only meeting list. Booking and verification stay on the web app. */
export function AppointmentsScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const { spacing } = useTheme();
  const [filter, setFilter] = useState<AppointmentFilter>('upcoming');
  const query = useAppointments(filter);
  const items = query.data?.data.items ?? [];

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
        <View style={styles.chips}>
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
          ))}
        </View>
        {query.data ? <CachedBanner fromCache={query.data.fromCache} syncedAt={query.data.syncedAt} /> : null}
      </View>

      {query.isPending ? (
        <LoadingView />
      ) : query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 }}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          renderItem={({ item }) => {
            const done = Number(item.done) === 1;
            const notDone = Number(item.not_done) === 1;
            const phone = item.leadMobile || item.leadPhone;
            return (
              <Card onPress={() => navigation.navigate('LeadDetail', { leadId: item.leadid })}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text variant="heading" numberOfLines={1}>
                      {fullName(item.fname, item.lname, `Lead #${item.leadid}`)}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {formatDate(item.date)} · {formatTime(item.appointtime)}
                      {item.branchName ? ` · ${item.branchName}` : ''}
                    </Text>
                  </View>
                  <Badge label={done ? 'Done' : notDone ? 'Not done' : 'Scheduled'} tone={done ? 'success' : notDone ? 'neutral' : 'info'} />
                </View>
                {item.counselorName ? (
                  <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
                    With {item.counselorName}
                  </Text>
                ) : null}
                {phone && !done ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Button title="Call client" size="sm" variant="outline" icon="call" onPress={() => void callPhone(phone)} fullWidth />
                  </View>
                ) : null}
              </Card>
            );
          }}
          ListEmptyComponent={<EmptyState icon="calendar-outline" title="No meetings" message={filter === 'today' ? 'Nothing scheduled for today.' : undefined} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
});
