import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Badge, Button, Chip, EmptyState, ErrorState, Icon, LoadingView, Screen, SearchBar, Text } from '@/components';
import type { AppStackParamList } from '@/navigation/types';
import { errorMessage } from '@/services/api/errors';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { timeAgo } from '@/utils/format';
import { useDebouncedValue } from '@/utils/useDebouncedValue';
import { useMailAction, useMailList, useSyncMail } from '../hooks';
import type { MailFolder, MailRow } from '../types';

const FOLDERS: { value: MailFolder; label: string }[] = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'starred', label: 'Starred' },
  { value: 'sent', label: 'Sent' },
  { value: 'archive', label: 'Archive' },
  { value: 'trash', label: 'Trash' },
];

/** The signed-in user's own mailbox (the CEO connects it on the web under Counselor Mailboxes). */
export function MailScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const { colors, spacing } = useTheme();
  const [folder, setFolder] = useState<MailFolder>('inbox');
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 350);
  const query = useMailList(folder, debouncedSearch, unreadOnly);
  const action = useMailAction();
  const sync = useSyncMail();

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.page.items) ?? [], [query.data]);
  const first = query.data?.pages[0];
  const mailbox = first?.mailbox ?? null;
  const counts = first?.counts;

  const refresh = () => {
    // Pull new mail from the server first (when IMAP is set up), then reload the list.
    if (mailbox?.imap_host) {
      sync.mutate(undefined, {
        onSuccess: (r) => { if (r.fetched) toast.success(`${r.fetched} new message${r.fetched === 1 ? '' : 's'}`); },
        onError: (e) => toast.error(errorMessage(e, 'Unable to check for new mail.')),
      });
    } else {
      void query.refetch();
    }
  };

  const open = (row: MailRow) => navigation.navigate('MailThread', { messageId: row.id });

  if (query.isPending) return <Screen><LoadingView /></Screen>;
  if (query.isError && !query.data) return <Screen><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Screen>;
  if (!mailbox) {
    return (
      <Screen>
        <EmptyState
          icon="mail-outline"
          title="No mailbox connected"
          message="Ask the CEO to connect your email under Counselor Mailboxes in the web CRM."
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
        <View style={styles.header}>
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{mailbox.email}</Text>
          <Button title="Compose" size="sm" icon="create" onPress={() => navigation.navigate('MailCompose')} />
        </View>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search mail" />
        <View style={styles.chips}>
          {FOLDERS.map((f) => (
            <Chip
              key={f.value}
              label={f.label}
              selected={folder === f.value}
              count={f.value === 'inbox' ? counts?.inbox_unread : f.value === 'starred' ? counts?.starred : undefined}
              onPress={() => setFolder(f.value)}
            />
          ))}
          <Chip label="Unread" selected={unreadOnly} onPress={() => setUnreadOnly((v) => !v)} />
        </View>
        {mailbox.last_error ? <Text variant="caption" tone="danger">Mailbox issue: {mailbox.last_error}</Text> : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: spacing.xxl, flexGrow: 1 }}
        refreshing={query.isRefetching || sync.isPending}
        onRefresh={refresh}
        onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={<EmptyState icon="mail-open-outline" title={`Nothing in ${FOLDERS.find((f) => f.value === folder)?.label.toLowerCase()}`} />}
        renderItem={({ item }) => {
          const unread = item.direction === 'in' && !item.is_read;
          return (
            <Pressable
              onPress={() => open(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.subject || 'No subject'}, ${unread ? 'unread' : 'read'}`}
              style={({ pressed }) => [styles.row, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={item.is_starred ? 'Remove star' : 'Add star'}
                onPress={() => action.mutate({ ids: [item.id], action: item.is_starred ? 'unstar' : 'star' })}
              >
                <Icon name={item.is_starred ? 'star' : 'star-outline'} size={20} color={item.is_starred ? colors.warning : colors.textMuted} />
              </Pressable>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.header}>
                  <Text variant={unread ? 'bodyStrong' : 'body'} numberOfLines={1} style={{ flex: 1 }}>
                    {item.direction === 'in' ? item.from_name || item.from_address : `To: ${item.to_addresses}`}
                  </Text>
                  <Text variant="caption" tone="muted">{timeAgo(item.message_date)}</Text>
                </View>
                <Text variant={unread ? 'bodyStrong' : 'body'} numberOfLines={1}>
                  {item.subject || '(no subject)'}{item.thread_count > 1 ? `  (${item.thread_count})` : ''}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>{item.preview}</Text>
                <View style={styles.chips}>
                  {item.has_attachments ? <Icon name="attach" size={14} color={colors.textMuted} /> : null}
                  {item.lead_name ? <Badge label={`Lead: ${item.lead_name}`} tone="info" /> : null}
                  {item.status === 'failed' ? <Badge label="Failed" tone="danger" /> : null}
                </View>
              </View>
              {unread ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
});
