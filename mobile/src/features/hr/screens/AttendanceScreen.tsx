import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, StyleSheet, View } from 'react-native';
import { Badge, Button, CachedBanner, Card, Chip, Divider, EmptyState, ErrorState, LoadingView, Screen, SectionHeader, Text } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import { errorMessage } from '@/services/api/errors';
import { useOfflineQuery } from '@/services/db/useOfflineQuery';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate, formatTime } from '@/utils/format';
import { BREAK_TYPES, clockIn, clockOut, endBreak, fetchAttendance, startBreak, type BreakType } from '../api';

/** Clock in / out and breaks for the signed-in employee, plus the last two weeks. */
export function AttendanceScreen() {
  const client = useQueryClient();
  const { spacing } = useTheme();
  const query = useOfflineQuery({ queryKey: queryKeys.attendance, cacheKey: 'attendance', queryFn: () => fetchAttendance(14) });

  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.attendance }),
    onError: (e) => toast.error(errorMessage(e, 'That did not work.')),
  });

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

  const { today, breaks, history } = query.data.data;
  const checkedIn = !!today?.check_in && !today?.check_out;
  const finished = !!today?.check_out;
  const activeBreak = breaks.find((b) => !b.end_time) ?? null;

  const confirm = (title: string, verb: string, fn: () => Promise<unknown>, done: string) =>
    Alert.alert(title, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: verb, onPress: () => run.mutate(fn, { onSuccess: () => toast.success(done) }) },
    ]);

  return (
    <Screen scroll refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <CachedBanner fromCache={query.data.fromCache} syncedAt={query.data.syncedAt} />

      <Card>
        <View style={styles.between}>
          <Text variant="heading">Today</Text>
          <Badge label={finished ? 'Shift complete' : checkedIn ? 'Clocked in' : 'Not clocked in'} tone={finished ? 'neutral' : checkedIn ? 'success' : 'warning'} />
        </View>
        <View style={[styles.times, { marginVertical: spacing.md }]}>
          <View>
            <Text variant="caption" tone="muted">
              In
            </Text>
            <Text variant="title">{formatTime(today?.check_in)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="caption" tone="muted">
              Out
            </Text>
            <Text variant="title">{formatTime(today?.check_out)}</Text>
          </View>
        </View>

        {!today?.check_in ? (
          <Button title="Clock in" icon="log-in" onPress={() => confirm('Clock in now?', 'Clock in', clockIn, 'Clocked in')} loading={run.isPending} fullWidth />
        ) : checkedIn ? (
          <Button title="Clock out" icon="log-out" variant="outline" onPress={() => confirm('Clock out now?', 'Clock out', clockOut, 'Clocked out')} loading={run.isPending} fullWidth />
        ) : null}
      </Card>

      {checkedIn ? (
        <>
          <SectionHeader title="Break" />
          <Card>
            {activeBreak ? (
              <View style={{ gap: spacing.md }}>
                <Text>
                  On <Text variant="bodyStrong">{activeBreak.break_type}</Text> since {formatTime(activeBreak.start_time.slice(11, 19) || activeBreak.start_time)}
                </Text>
                <Button title="End break" icon="play" onPress={() => run.mutate(endBreak, { onSuccess: () => toast.success('Break ended') })} loading={run.isPending} fullWidth />
              </View>
            ) : (
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {BREAK_TYPES.map((type: BreakType) => (
                    <Chip key={type} label={type} onPress={() => run.mutate(() => startBreak(type), { onSuccess: () => toast.info(`${type} started`) })} />
                  ))}
                </View>
                <Text variant="caption" tone="muted">
                  Tap a break type to start it.
                </Text>
              </View>
            )}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Last 14 days" />
      <Card padded={false}>
        {history.length === 0 ? (
          <EmptyState icon="time-outline" title="No attendance yet" />
        ) : (
          history.map((row, i) => (
            <View key={row.attendance_id}>
              {i > 0 ? <Divider /> : null}
              <View style={[styles.between, { padding: spacing.md }]}>
                <View>
                  <Text variant="bodyStrong">{formatDate(row.date)}</Text>
                  <Text variant="caption" tone="muted">
                    {formatTime(row.check_in)} – {formatTime(row.check_out)}
                  </Text>
                </View>
                <Badge label={row.status} tone={/present|on time/i.test(row.status) ? 'success' : /late|half/i.test(row.status) ? 'warning' : 'neutral'} />
              </View>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
});
