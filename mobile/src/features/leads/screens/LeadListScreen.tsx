import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CachedBanner, Chip, EmptyState, ErrorState, Icon, LoadingView, Screen, SearchBar, SegmentedControl } from '@/components';
import { isCounsellor } from '@/features/auth/rbac';
import { canAccess } from '@/navigation/routeAccess';
import type { AppStackParamList } from '@/navigation/types';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { useTheme } from '@/theme/ThemeProvider';
import { useDebouncedValue } from '@/utils/useDebouncedValue';
import { LeadCard } from '../components/LeadCard';
import { useLeadList, useLeadStatuses } from '../hooks';
import type { LeadListItem, LeadView } from '../types';

export function LeadListScreen({ view: fixedView }: { view?: LeadView } = {}) {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const user = useSessionStore(selectUser);
  const { colors, spacing } = useTheme();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  // Counselors only ever see their own leads (the server scopes it); everyone else can
  // switch between the whole book and just their own.
  const [view, setView] = useState<LeadView>('leads');
  const activeView = fixedView ?? view;
  const canSwitchView = !fixedView && !isCounsellor(user);
  const canCreate = canAccess('LeadForm', user) && !fixedView;

  const debouncedSearch = useDebouncedValue(search);
  const statuses = useLeadStatuses();
  const list = useLeadList({ search: debouncedSearch, status: status ?? undefined, view: activeView });

  const leads = useMemo<LeadListItem[]>(() => list.data?.pages.flatMap((page) => page.data.items) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const statusOptions = useMemo(() => ['New', ...(statuses.data?.map((s) => s.name) ?? [])], [statuses.data]);

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, email, phone" />
          </View>
          {canCreate ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add lead"
              onPress={() => navigation.navigate('LeadForm')}
              style={[styles.add, { backgroundColor: colors.primary }]}
            >
              <Icon name="add" size={24} color={colors.onPrimary} />
            </Pressable>
          ) : null}
        </View>
        {canSwitchView ? (
          <SegmentedControl
            options={[
              { value: 'leads', label: 'All leads' },
              { value: 'my-leads', label: 'My leads' },
            ]}
            value={view}
            onChange={setView}
          />
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Chip label="All" selected={status === null} onPress={() => setStatus(null)} />
          {statusOptions.map((name) => (
            <Chip key={name} label={name} selected={status === name} onPress={() => setStatus(status === name ? null : name)} />
          ))}
        </ScrollView>
        {first ? <CachedBanner fromCache={first.fromCache} syncedAt={first.syncedAt} /> : null}
      </View>

      {list.isPending ? (
        <LoadingView />
      ) : list.isError && !list.data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={leads}
          keyExtractor={(lead) => String(lead.id)}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => void list.refetch()}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <LeadCard lead={item} statuses={statuses.data} onPress={() => navigation.navigate('LeadDetail', { leadId: item.id })} />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={debouncedSearch || status ? 'No matching leads' : 'No leads yet'}
              message={debouncedSearch || status ? 'Try a different search or filter.' : undefined}
            />
          }
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.primary} /> : null}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBar: { flex: 1 },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

/** Bottom-tab entry: every lead the user may see. */
export const LeadsTabScreen = () => <LeadListScreen />;

/** Clients (converted leads) reuse the lead list with the server's `clients` view. */
export const ClientsScreen = () => <LeadListScreen view="clients" />;
