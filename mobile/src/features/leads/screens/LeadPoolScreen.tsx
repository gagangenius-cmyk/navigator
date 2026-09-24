import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { Badge, Button, CachedBanner, Card, EmptyState, ErrorState, LoadingView, Screen, SearchBar, Text } from '@/components';
import type { AppStackParamList } from '@/navigation/types';
import { errorMessage } from '@/services/api/errors';
import { toast } from '@/store/uiStore';
import { priorityTone } from '@/theme/status';
import { useTheme } from '@/theme/ThemeProvider';
import { fullName, timeAgo } from '@/utils/format';
import { useDebouncedValue } from '@/utils/useDebouncedValue';
import { useClaimLead, useLeadPool } from '../hooks';
import type { PoolLead } from '../types';

/** Unassigned leads waiting in the branch queue. Agents can claim one for themselves. */
export function LeadPoolScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const { spacing } = useTheme();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const pool = useLeadPool(debounced);
  const claim = useClaimLead();

  const canClaim = pool.data?.data.canClaim ?? false;
  const leads = pool.data?.data.leads ?? [];

  const confirmClaim = (lead: PoolLead) => {
    Alert.alert('Claim this lead?', `${fullName(lead.fname, lead.lname)} will be assigned to you.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Claim',
        onPress: () =>
          claim.mutate(lead.id, {
            onSuccess: () => {
              toast.success('Lead claimed');
              navigation.navigate('LeadDetail', { leadId: lead.id });
            },
            onError: (error) => toast.error(errorMessage(error, 'Unable to claim this lead.')),
          }),
      },
    ]);
  };

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search the pool" />
        {pool.data ? <CachedBanner fromCache={pool.data.fromCache} syncedAt={pool.data.syncedAt} /> : null}
      </View>

      {pool.isPending ? (
        <LoadingView />
      ) : pool.isError && !pool.data ? (
        <ErrorState error={pool.error} onRetry={() => void pool.refetch()} />
      ) : (
        <FlatList
          data={leads}
          keyExtractor={(lead) => String(lead.id)}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 }}
          refreshing={pool.isRefetching}
          onRefresh={() => void pool.refetch()}
          renderItem={({ item }) => (
            <Card onPress={() => navigation.navigate('LeadDetail', { leadId: item.id })}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text variant="heading" numberOfLines={1}>
                    {fullName(item.fname, item.lname)}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {[item.serviceInterest, item.nationality, item.branchName].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {item.priority ? <Badge label={item.priority} tone={priorityTone(item.priority)} /> : null}
              </View>
              <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
                Waiting {timeAgo(item.poolEnteredAt ?? item.created).replace(' ago', '')}
              </Text>
              {canClaim ? (
                <View style={{ marginTop: spacing.md }}>
                  <Button title="Claim lead" size="sm" icon="hand-left" onPress={() => confirmClaim(item)} loading={claim.isPending && claim.variables === item.id} fullWidth />
                </View>
              ) : null}
            </Card>
          )}
          ListEmptyComponent={<EmptyState icon="checkmark-done-circle-outline" title="The pool is empty" message="Every lead has an owner." />}
        />
      )}
    </Screen>
  );
}
