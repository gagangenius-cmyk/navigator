import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BarList, CachedBanner, Card, Divider, EmptyState, ErrorState, Icon, LoadingView, Screen, SectionHeader, SegmentedControl, StatCard, Text } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import { canSeeApprovals, homeVariant, type HomeVariant } from '@/features/auth/rbac';
import { useApprovalCounts } from '@/features/approvals/hooks';
import type { AppStackParamList } from '@/navigation/types';
import { useOfflineQuery } from '@/services/db/useOfflineQuery';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCurrency, formatNumber, formatTime, fullName } from '@/utils/format';
import { fetchDashboard, percentChange, type DashboardRange, type DashboardResponse } from '../api';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

const pct = (value: number) => `${(Number(value) || 0).toFixed(1)}%`;

function StatGrid({ stats, variant }: { stats: DashboardResponse; variant: HomeVariant }) {
  const { spacing } = useTheme();
  const t = stats.monthTrend;
  const leadDelta = percentChange(t.thisMonthLeads, t.lastMonthLeads);
  const convDelta = percentChange(t.thisMonthConverted, t.lastMonthConverted);

  const tiles =
    variant === 'counselor'
      ? [
          <StatCard key="a" label="My leads" value={formatNumber(stats.totalLeads)} icon="people" delta={leadDelta} />,
          <StatCard key="b" label="Converted" value={formatNumber(stats.convertedLeads)} icon="checkmark-circle" tone="success" delta={convDelta} />,
          <StatCard key="c" label="Conversion" value={pct(stats.conversionRate)} icon="trending-up" tone="accent" />,
          <StatCard key="d" label="Follow-ups due" value={formatNumber(stats.pendingFollowups)} icon="alarm" tone="warning" invertDelta />,
          <StatCard key="e" label="Meetings today" value={formatNumber(stats.todayAppointments)} icon="calendar" />,
          <StatCard key="f" label="Collected" value={formatCurrency(stats.totalPaidAmount)} icon="cash" tone="success" />,
        ]
      : variant === 'manager'
        ? [
            <StatCard key="a" label="Leads" value={formatNumber(stats.totalLeads)} icon="people" delta={leadDelta} />,
            <StatCard key="b" label="Converted" value={formatNumber(stats.convertedLeads)} icon="checkmark-circle" tone="success" delta={convDelta} />,
            <StatCard key="c" label="Conversion" value={pct(stats.conversionRate)} icon="trending-up" tone="accent" />,
            <StatCard key="d" label="Team size" value={formatNumber(stats.totalEmployees)} icon="business" />,
            <StatCard key="e" label="Collected" value={formatCurrency(stats.totalPaidAmount)} icon="cash" tone="success" />,
            <StatCard key="f" label="Outstanding" value={formatCurrency(stats.totalBalance)} icon="wallet" tone="warning" />,
          ]
        : [
            <StatCard key="a" label="Total leads" value={formatNumber(stats.totalLeads)} icon="people" delta={leadDelta} />,
            <StatCard key="b" label="Conversion" value={pct(stats.conversionRate)} icon="trending-up" tone="accent" delta={convDelta} />,
            <StatCard key="c" label="Revenue (ex VAT)" value={formatCurrency(stats.totalRevenue)} icon="stats-chart" tone="success" />,
            <StatCard key="d" label="Outstanding" value={formatCurrency(stats.totalBalance)} icon="wallet" tone="warning" />,
            <StatCard key="e" label="Clients" value={formatNumber(stats.totalClients)} icon="ribbon" />,
            <StatCard key="f" label="Active cases" value={formatNumber(stats.activeOperations)} icon="briefcase" />,
          ];

  return <View style={[styles.grid, { gap: spacing.md }]}>{tiles}</View>;
}

/** Role-aware home: executive (CEO / director), manager (team leader / area manager), counselor, other. */
export function DashboardScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const user = useSessionStore(selectUser);
  const { colors, spacing } = useTheme();
  const [range, setRange] = useState<DashboardRange>('month');
  const approvals = useApprovalCounts();

  const query = useOfflineQuery({
    queryKey: queryKeys.dashboard(range),
    cacheKey: `dashboard:${range}`,
    queryFn: () => fetchDashboard(range),
    refetchInterval: 120_000,
  });

  const variant = homeVariant(user);
  const firstName = user?.name?.split(' ')[0] ?? '';

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

  const stats = query.data.data;
  const today = stats.data;
  const showBreakdowns = variant === 'executive' || variant === 'manager';

  return (
    <Screen scroll refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <View style={{ marginBottom: spacing.md }}>
        <Text variant="title">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </Text>
        <Text tone="muted">{user?.roleName}</Text>
      </View>

      <CachedBanner fromCache={query.data.fromCache} syncedAt={query.data.syncedAt} />

      {canSeeApprovals(user) && approvals.total > 0 ? (
        <Card onPress={() => navigation.navigate('Tabs', { screen: 'Approvals' })} style={{ marginBottom: spacing.md, borderColor: colors.danger }} accessibilityLabel={`${approvals.total} approvals waiting`}>
          <View style={styles.approvalRow}>
            <View style={[styles.approvalIcon, { backgroundColor: colors.tones.danger.background }]}>
              <Icon name="shield-checkmark" size={22} color={colors.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading">{approvals.total} awaiting your decision</Text>
              <Text variant="caption" tone="muted">
                {[
                  approvals.discount ? `${approvals.discount} discount` : null,
                  approvals.payment ? `${approvals.payment} payment` : null,
                  approvals.compliance ? `${approvals.compliance} compliance` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </Card>
      ) : null}

      <SegmentedControl
        options={[
          { value: 'month', label: 'This month' },
          { value: 'all', label: 'All time' },
        ]}
        value={range}
        onChange={setRange}
      />

      <View style={{ marginTop: spacing.md }}>
        <StatGrid stats={stats} variant={variant} />
      </View>

      <SectionHeader title="Today" />
      <Card padded={false}>
        {today.todayAppointments.length === 0 && today.todayFollowUps.length === 0 ? (
          <EmptyState icon="sunny-outline" title="Nothing scheduled today" />
        ) : (
          <>
            {today.todayAppointments.slice(0, 5).map((a, i) => (
              <View key={`a${a.id}`}>
                {i > 0 ? <Divider /> : null}
                <TapRow onPress={() => navigation.navigate('LeadDetail', { leadId: a.leadid })}>
                  <View style={styles.todayRow}>
                    <Icon name="calendar" size={18} color={colors.info} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {fullName(a.fname, a.lname, `Lead #${a.leadid}`)}
                      </Text>
                      <Text variant="caption" tone="muted">
                        Meeting · {formatTime(a.appointtime)}
                      </Text>
                    </View>
                  </View>
                </TapRow>
              </View>
            ))}
            {today.todayFollowUps.slice(0, 5).map((f) => (
              <View key={`f${f.id}`}>
                <Divider />
                <TapRow onPress={() => navigation.navigate('LeadDetail', { leadId: f.lead_id })}>
                  <View style={styles.todayRow}>
                    <Icon name="alarm" size={18} color={colors.warning} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {fullName(f.fname, f.lname, `Lead #${f.lead_id}`)}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        Follow-up{f.message ? ` · ${f.message}` : ''}
                      </Text>
                    </View>
                  </View>
                </TapRow>
              </View>
            ))}
          </>
        )}
      </Card>

      {showBreakdowns ? (
        <>
          <SectionHeader title="Hot leads by priority" />
          <Card>
            <BarList items={stats.priorityBreakdown.map((p) => ({ label: p.name, value: p.value }))} />
          </Card>
          <SectionHeader title="Lead status" />
          <Card>
            <BarList items={stats.statusBreakdown.map((s) => ({ label: s.name, value: s.value }))} />
          </Card>
          <SectionHeader title="Top sources" />
          <Card>
            <BarList items={stats.sourceBreakdown.map((s) => ({ label: s.name, value: s.value }))} max={6} />
          </Card>
          <SectionHeader title="Top counselors" />
          <Card padded={false}>
            {stats.topEmployees.length === 0 ? (
              <EmptyState icon="people-outline" title="No data yet" />
            ) : (
              stats.topEmployees.slice(0, 6).map((e, i) => (
                <View key={`${e.name}${i}`}>
                  {i > 0 ? <Divider /> : null}
                  <View style={[styles.todayRow, { justifyContent: 'space-between' }]}>
                    <Text style={{ flex: 1 }} numberOfLines={1}>
                      {i + 1}. {e.name}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {formatNumber(e.leads)} leads · {e.conversion}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

// Tappable wrapper for the Today rows.
function TapRow({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  approvalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  approvalIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  todayRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
});
