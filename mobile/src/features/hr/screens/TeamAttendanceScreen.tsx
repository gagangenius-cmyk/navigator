import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlatList, View } from 'react-native';
import { Badge, Card, EmptyState, ErrorState, LoadingView, Screen, SegmentedControl, Text } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import { useTheme } from '@/theme/ThemeProvider';
import type { Tone } from '@/theme/tokens';
import { formatTime } from '@/utils/format';
import { fetchTeamAttendance, type TeamAttendanceRow } from '../api';

type Range = 'today' | 'week';

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const STATUS_TONE: Record<string, Tone> = {
  Present: 'success',
  Late: 'warning',
  'Half-Day': 'warning',
  Absent: 'danger',
  Leave: 'info',
  Holiday: 'neutral',
};

/**
 * Company/branch attendance for CEO and HR - the self-only AttendanceScreen is
 * everyone else's view; this is the oversight view, gated by hr.view/hr.reports.attendance
 * (see RootNavigator's routeAccess) and scoped server-side to the caller's branch unless
 * they can view every branch.
 */
export function TeamAttendanceScreen() {
  const { spacing } = useTheme();
  const [range, setRange] = useState<Range>('today');

  const { dateFrom, dateTo } = useMemo(() => {
    const today = new Date();
    if (range === 'today') return { dateFrom: isoDate(today), dateTo: isoDate(today) };
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    return { dateFrom: isoDate(weekAgo), dateTo: isoDate(today) };
  }, [range]);

  const query = useQuery({
    queryKey: [...queryKeys.attendance, 'team', dateFrom, dateTo],
    queryFn: () => fetchTeamAttendance(dateFrom, dateTo),
  });

  const rows = query.data ?? [];

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
        <Text variant="title">Team attendance</Text>
        <SegmentedControl
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'Last 7 days' },
          ]}
          value={range}
          onChange={setRange}
        />
      </View>

      {query.isPending ? (
        <LoadingView />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.attendance_id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm, flexGrow: 1 }}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          renderItem={({ item }: { item: TeamAttendanceRow }) => (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {item.employee_name || `Employee #${item.employee_id}`}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {item.date} · {formatTime(item.check_in)} – {formatTime(item.check_out)}
                  </Text>
                  {item.notes ? (
                    <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }} numberOfLines={2}>
                      {item.notes}
                    </Text>
                  ) : null}
                </View>
                <Badge label={item.status} tone={STATUS_TONE[item.status] ?? 'neutral'} />
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState icon="people-outline" title="No attendance records" message={range === 'today' ? 'Nobody has clocked in yet today.' : undefined} />
          }
        />
      )}
    </Screen>
  );
}
