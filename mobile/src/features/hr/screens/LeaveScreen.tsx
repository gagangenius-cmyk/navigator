import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Badge, Button, CachedBanner, Card, ChipGroup, DateTimeField, Divider, EmptyState, ErrorState, Input, LoadingView, Screen, SectionHeader, Sheet, Text, toOptions } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import { errorMessage } from '@/services/api/errors';
import { useOfflineQuery } from '@/services/db/useOfflineQuery';
import { toast } from '@/store/uiStore';
import { approvalTone } from '@/theme/status';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate, toIsoDate } from '@/utils/format';
import { applyLeave, fetchLeave, previewLeaveDays } from '../api';

function ApplySheet({ visible, onClose, leaveTypes }: { visible: boolean; onClose: () => void; leaveTypes: string[] }) {
  const client = useQueryClient();
  const { spacing } = useTheme();
  const [type, setType] = useState<string | null>(null);
  const [start, setStart] = useState<Date | null>(null);
  const [pickedEnd, setEnd] = useState<Date | null>(null);
  // The end can never precede the start: derive it rather than syncing state in an effect.
  const end = start && pickedEnd && pickedEnd < start ? start : pickedEnd;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Real working-day count (holidays excluded) from the same calculation the server records.
  const days = useQuery({
    queryKey: ['hr', 'leave-preview', start && toIsoDate(start), end && toIsoDate(end)],
    queryFn: () => previewLeaveDays(toIsoDate(start!), toIsoDate(end!)),
    enabled: !!start && !!end && end >= start,
  });

  const submit = useMutation({
    mutationFn: () => applyLeave({ leave_type: type!, start_date: toIsoDate(start!), end_date: toIsoDate(end!), reason }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.leave });
      toast.success('Leave request submitted');
      close();
    },
    onError: (e) => setError(errorMessage(e, 'Unable to submit the request.')),
  });

  const close = () => {
    setType(null);
    setStart(null);
    setEnd(null);
    setReason('');
    setError(null);
    onClose();
  };

  const send = () => {
    if (!type) return setError('Choose a leave type.');
    if (!start || !end) return setError('Pick the start and end dates.');
    setError(null);
    submit.mutate();
  };

  return (
    <Sheet visible={visible} onClose={close} title="Apply for leave" dismissable={!submit.isPending}>
      <View style={{ gap: spacing.md }}>
        <ChipGroup label="Leave type" options={toOptions(leaveTypes)} value={type} onSelect={setType} />
        <DateTimeField label="From" mode="date" value={start} onChange={setStart} minimumDate={new Date()} />
        <DateTimeField label="To" mode="date" value={end} onChange={setEnd} minimumDate={start ?? new Date()} />
        {days.data !== undefined ? (
          <Text tone="muted">
            {days.data} working day{days.data === 1 ? '' : 's'}
          </Text>
        ) : null}
        <Input label="Reason (optional)" value={reason} onChangeText={setReason} multiline editable={!submit.isPending} />
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button title="Submit request" onPress={send} loading={submit.isPending} fullWidth />
      </View>
    </Sheet>
  );
}

export function LeaveScreen() {
  const { spacing } = useTheme();
  const [applying, setApplying] = useState(false);
  const query = useOfflineQuery({ queryKey: queryKeys.leave, cacheKey: 'leave', queryFn: fetchLeave });

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

  const { balances, requests, leaveTypes } = query.data.data;

  return (
    <Screen scroll refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <CachedBanner fromCache={query.data.fromCache} syncedAt={query.data.syncedAt} />
      <Button title="Apply for leave" icon="add-circle" onPress={() => setApplying(true)} disabled={query.data.fromCache} fullWidth />

      <SectionHeader title="Balances" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
        {balances.map((b) => (
          <Card key={b.leave_type} style={styles.balance}>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {b.leave_type}
            </Text>
            <Text variant="display">{b.remaining_days}</Text>
            <Text variant="caption" tone="muted">
              of {b.entitlement_days} left
              {b.pending_days ? ` · ${b.pending_days} pending` : ''}
            </Text>
          </Card>
        ))}
        {balances.length === 0 ? <Text tone="muted">No leave entitlement set up yet.</Text> : null}
      </ScrollView>

      <SectionHeader title="My requests" />
      <Card padded={false}>
        {requests.length === 0 ? (
          <EmptyState icon="calendar-clear-outline" title="No leave requests" />
        ) : (
          requests.map((r, i) => (
            <View key={r.leave_id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ padding: spacing.md, gap: 4 }}>
                <View style={styles.between}>
                  <Text variant="bodyStrong">{r.leave_type}</Text>
                  <Badge label={r.status} tone={approvalTone(r.status)} />
                </View>
                <Text variant="caption" tone="muted">
                  {formatDate(r.start_date)} – {formatDate(r.end_date)} · {r.days_requested} day{r.days_requested === 1 ? '' : 's'}
                </Text>
                {r.reason ? <Text variant="caption">{r.reason}</Text> : null}
              </View>
            </View>
          ))
        )}
      </Card>

      <ApplySheet visible={applying} onClose={() => setApplying(false)} leaveTypes={leaveTypes} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  balance: { width: 150 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
