import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { Badge, Button, CachedBanner, Card, Chip, EmptyState, ErrorState, LoadingView, Screen, Text } from '@/components';
import type { AppStackParamList } from '@/navigation/types';
import { errorMessage } from '@/services/api/errors';
import { toast } from '@/store/uiStore';
import { approvalTone } from '@/theme/status';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTime, fullName } from '@/utils/format';
import { callPhone } from '@/utils/phone';
import type { FollowUpFilter } from '../api';
import { isFollowUpOverdue } from '../followUpRules';
import { useFollowUpAction, useFollowUps } from '../hooks';

const FILTERS: { value: FollowUpFilter; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
];

export function FollowUpsScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const { spacing } = useTheme();
  const [filter, setFilter] = useState<FollowUpFilter>('upcoming');
  const query = useFollowUps(filter);
  const action = useFollowUpAction();

  const items = query.data?.data.items ?? [];

  const complete = (id: number, leadId: number) =>
    action.mutate(
      { id, leadId, action: 'complete' },
      {
        onSuccess: () => toast.success('Follow-up completed'),
        onError: (e) => toast.error(errorMessage(e, 'Unable to complete the follow-up.')),
      },
    );

  const cancel = (id: number, leadId: number) =>
    Alert.alert('Cancel this follow-up?', undefined, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel it',
        style: 'destructive',
        onPress: () =>
          action.mutate(
            { id, leadId, action: 'cancel' },
            { onSuccess: () => toast.info('Follow-up cancelled'), onError: (e) => toast.error(errorMessage(e, 'Unable to cancel it.')) },
          ),
      },
    ]);

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
            const overdue = isFollowUpOverdue(item.status, item.reminder_date, query.dataUpdatedAt);
            const shownStatus = overdue ? 'overdue' : item.status;
            return (
              <Card onPress={() => navigation.navigate('LeadDetail', { leadId: item.lead_id })}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text variant="heading" numberOfLines={1}>
                      {fullName(item.fname, item.lname, `Lead #${item.lead_id}`)}
                    </Text>
                    <Text variant="caption" tone={overdue ? 'danger' : 'muted'}>
                      {formatDateTime(item.reminder_date)}
                    </Text>
                  </View>
                  <Badge label={shownStatus} tone={approvalTone(shownStatus)} />
                </View>
                {item.message ? (
                  <Text tone="muted" style={{ marginTop: spacing.sm }} numberOfLines={3}>
                    {item.message}
                  </Text>
                ) : null}
                {item.status === 'pending' ? (
                  <View style={[styles.actions, { marginTop: spacing.md }]}>
                    {item.phone ? <Button title="Call" size="sm" variant="outline" icon="call" onPress={() => void callPhone(item.phone)} style={styles.flex} /> : null}
                    <Button title="Done" size="sm" icon="checkmark" onPress={() => complete(item.id, item.lead_id)} loading={action.isPending && action.variables?.id === item.id && action.variables.action === 'complete'} style={styles.flex} />
                    <Button title="Cancel" size="sm" variant="ghost" onPress={() => cancel(item.id, item.lead_id)} style={styles.flex} />
                  </View>
                ) : null}
              </Card>
            );
          }}
          ListEmptyComponent={<EmptyState icon="alarm-outline" title={filter === 'overdue' ? 'Nothing overdue' : 'No follow-ups'} message={filter === 'upcoming' ? 'Schedule one from a lead.' : undefined} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  actions: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
