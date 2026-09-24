import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Button, CachedBanner, EmptyState, ErrorState, Icon, LoadingView, Screen, Text, type IconName } from '@/components';
import { openTarget } from '@/navigation/openTarget';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { useTheme } from '@/theme/ThemeProvider';
import { timeAgo } from '@/utils/format';
import type { NotificationRow } from '../api';
import { useMarkRead, useNotifications } from '../hooks';
import { targetForNotification } from '../target';

const ICONS: Record<string, IconName> = {
  lead_assigned: 'person-add',
  discount_requested: 'pricetag',
  discount_reviewed: 'pricetag',
  compliance_submission: 'shield-checkmark',
  compliance_review: 'shield-checkmark',
  payment_submission: 'card',
  payment_verification: 'card',
  followup: 'alarm',
  appointment: 'calendar',
};

export function NotificationsScreen() {
  const { colors, spacing } = useTheme();
  const user = useSessionStore(selectUser);
  const query = useNotifications();
  const markRead = useMarkRead();

  const rows = query.data?.data.notifications ?? [];
  const unread = rows.filter((n) => !n.isRead);

  const open = (row: NotificationRow) => {
    if (!row.isRead) markRead.mutate([row.id]);
    const target = targetForNotification(row, user);
    if (target) openTarget(target);
  };

  return (
    <Screen padded={false}>
      {query.data ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <CachedBanner fromCache={query.data.fromCache} syncedAt={query.data.syncedAt} />
        </View>
      ) : null}

      {query.isPending ? (
        <LoadingView />
      ) : query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => String(row.id)}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          contentContainerStyle={{ flexGrow: 1 }}
          ListHeaderComponent={
            unread.length > 0 ? (
              <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                <Button title={`Mark all ${unread.length} as read`} variant="secondary" size="sm" icon="checkmark-done" onPress={() => markRead.mutate(unread.map((n) => n.id))} loading={markRead.isPending} />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.isRead ? '' : 'Unread. '}${item.title}. ${item.message}`}
              onPress={() => open(item)}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: colors.border, backgroundColor: item.isRead ? 'transparent' : colors.primarySoft, opacity: pressed ? 0.8 : 1, paddingHorizontal: spacing.lg },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Icon name={ICONS[item.type] ?? 'notifications'} size={18} color={colors.primary} />
              </View>
              <View style={styles.body}>
                <Text variant={item.isRead ? 'body' : 'bodyStrong'} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {item.message}
                </Text>
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {timeAgo(item.createdAt)}
                </Text>
              </View>
              {!item.isRead ? <View style={[styles.dot, { backgroundColor: colors.danger }]} /> : null}
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState icon="notifications-off-outline" title="No notifications" message="New leads and approvals will show up here." />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  body: { flex: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
