import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { CachedBanner, Chip, EmptyState, ErrorState, LoadingView, Screen, SegmentedControl, Text, type SegmentOption } from '@/components';
import { canAccess, approvalSegmentsFor } from '@/navigation/routeAccess';
import type { AppStackParamList, TabParamList } from '@/navigation/types';
import type { ApprovalSegment } from '@/services/push/router';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { useTheme } from '@/theme/ThemeProvider';
import { ApprovalCard, approvalItemId, approvalItemKey, type ApprovalItem } from '../components/ApprovalCards';
import type { Decision, StatusFilter } from '../decisionRules';
import { useApprovalCounts, useComplianceList, useDiscountList, usePaymentList } from '../hooks';

const SEGMENT_LABEL: Record<ApprovalSegment, string> = { discounts: 'Discounts', payments: 'Accounts', compliance: 'Compliance' };
const APPROVAL_KIND = { discounts: 'discount', payments: 'payment', compliance: 'compliance' } as const;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/**
 * The approver's inbox: discount requests, Accounts payment approvals and compliance
 * sign-offs in one place. This is where the CEO's push notifications land. Which
 * segments appear depends on role (see approvalSegmentsFor); the badge counts refresh
 * every minute and immediately when a push arrives.
 */
export function ApprovalDashboardScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const route = useRoute<RouteProp<TabParamList, 'Approvals'>>();
  const user = useSessionStore(selectUser);
  const { spacing } = useTheme();

  const segments = useMemo(() => approvalSegmentsFor(user), [user]);
  const [segment, setSegment] = useState<ApprovalSegment>(route.params?.segment ?? segments[0] ?? 'discounts');
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const counts = useApprovalCounts();

  // A notification tap can re-point this screen (e.g. "payment awaiting verification"). Adjusting state
  // while rendering (React's documented pattern for state derived from props) avoids an extra effect pass.
  const requested = route.params?.segment;
  const paramKey = `${requested ?? ''}:${route.params?.highlightId ?? ''}`;
  const [seenParamKey, setSeenParamKey] = useState(paramKey);
  if (paramKey !== seenParamKey) {
    setSeenParamKey(paramKey);
    if (requested && segments.includes(requested)) {
      setSegment(requested);
      setFilter('pending');
    }
  }

  const discounts = useDiscountList(filter, segment === 'discounts');
  const payments = usePaymentList(filter, segment === 'payments');
  const compliance = useComplianceList(filter, segment === 'compliance');
  const active = segment === 'discounts' ? discounts : segment === 'payments' ? payments : compliance;

  const items = useMemo<ApprovalItem[]>(() => {
    if (segment === 'discounts') return (discounts.data?.data.items ?? []).map((row) => ({ kind: 'discount', row }));
    if (segment === 'payments') return (payments.data?.data.items ?? []).map((row) => ({ kind: 'payment', row }));
    return (compliance.data?.data ?? []).map((row) => ({ kind: 'compliance', row }));
  }, [segment, discounts.data, payments.data, compliance.data]);

  const options: SegmentOption<ApprovalSegment>[] = segments.map((value) => ({
    value,
    label: SEGMENT_LABEL[value],
    badge: counts[APPROVAL_KIND[value]] || undefined,
  }));

  const decide = useCallback(
    (item: ApprovalItem, decision: Decision) => {
      navigation.navigate('ConfirmDecision', { approval: item.kind, decision, recordId: approvalItemId(item), leadId: 'leadId' in item.row ? item.row.leadId ?? undefined : undefined });
    },
    [navigation],
  );

  if (!canAccess('Approvals', user) || segments.length === 0) {
    return (
      <Screen>
        <EmptyState icon="lock-closed-outline" title="Nothing to approve" message="Approvals are available to managers, the CEO and Accounts." />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
        {segments.length > 1 ? <SegmentedControl options={options} value={segment} onChange={(v) => { setSegment(v); setFilter('pending'); }} /> : null}
        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
          ))}
        </View>
        {active.data ? <CachedBanner fromCache={active.data.fromCache} syncedAt={active.data.syncedAt} /> : null}
      </View>

      {active.isPending ? (
        <LoadingView />
      ) : active.isError && !active.data ? (
        <ErrorState error={active.error} onRetry={() => void active.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={approvalItemKey}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 }}
          refreshing={active.isRefetching}
          onRefresh={() => void active.refetch()}
          renderItem={({ item }) => (
            <ApprovalCard item={item} highlighted={route.params?.highlightId === approvalItemId(item)} onDecide={(d) => decide(item, d)} />
          )}
          ListEmptyComponent={
            <EmptyState
              icon={filter === 'pending' ? 'checkmark-done-circle-outline' : 'file-tray-outline'}
              title={filter === 'pending' ? 'All caught up' : `No ${filter} items`}
              message={filter === 'pending' ? 'Nothing is waiting for your decision.' : undefined}
            />
          }
          ListFooterComponent={
            items.length >= 50 ? (
              <Text variant="caption" tone="muted" align="center">
                Showing the 50 most recent.
              </Text>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ filters: { flexDirection: 'row' } });
