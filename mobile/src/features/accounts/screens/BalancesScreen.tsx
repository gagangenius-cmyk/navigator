import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, CachedBanner, Card, EmptyState, ErrorState, LoadingView, Screen, SearchBar, Text } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import type { AppStackParamList } from '@/navigation/types';
import { withOfflineCache } from '@/services/db/offline';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCurrency, formatDate, fullName } from '@/utils/format';
import { callPhone } from '@/utils/phone';
import { useDebouncedValue } from '@/utils/useDebouncedValue';
import { fetchBalances } from '../api';

/**
 * Outstanding client balances, scoped by role on the server (counselors see their own).
 * Read-only on mobile: recording a payment needs a proof-of-payment upload that the web
 * app performs through a browser-only Vercel Blob client, so it stays on the web.
 */
export function BalancesScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const { colors, spacing } = useTheme();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);

  const query = useInfiniteQuery({
    queryKey: [...queryKeys.balances, debounced],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => withOfflineCache(`balances:${debounced}:${pageParam}`, () => fetchBalances(pageParam, debounced), { cache: pageParam === 1 }),
    getNextPageParam: (last) => (last.data.page < last.data.totalPages ? last.data.page + 1 : undefined),
  });

  const rows = query.data?.pages.flatMap((p) => p.data.items) ?? [];
  const first = query.data?.pages[0];

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search client or agreement" />
        {first ? <CachedBanner fromCache={first.fromCache} syncedAt={first.syncedAt} /> : null}
      </View>

      {query.isPending ? (
        <LoadingView />
      ) : query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => String(row.opportunityId)}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 }}
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <Card onPress={() => navigation.navigate('LeadDetail', { leadId: item.leadId })}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text variant="heading" numberOfLines={1}>
                    {fullName(item.fname, item.lname)}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {[item.serviceName, item.agreementNumber].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="heading" tone="warning">
                    {formatCurrency(item.payBalance, item.currencyCode)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    of {formatCurrency(item.payTotal, item.currencyCode)}
                  </Text>
                </View>
              </View>
              {item.dueDate ? (
                <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
                  Due {formatDate(item.dueDate)}
                  {item.demdRemark ? ` · ${item.demdRemark}` : ''}
                </Text>
              ) : null}
              {item.phone ? (
                <View style={{ marginTop: spacing.md }}>
                  <Button title="Call client" size="sm" variant="outline" icon="call" onPress={() => void callPhone(item.phone)} fullWidth />
                </View>
              ) : null}
            </Card>
          )}
          ListEmptyComponent={<EmptyState icon="wallet-outline" title="No outstanding balances" />}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.primary} /> : null}
        />
      )}
    </Screen>
  );
}
