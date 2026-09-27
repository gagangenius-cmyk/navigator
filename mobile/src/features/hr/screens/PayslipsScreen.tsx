import { useQuery } from '@tanstack/react-query';
import { FlatList, Linking, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, LoadingView, Screen, Text } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCurrency } from '@/utils/format';
import { fetchPayslips } from '../api';

/** The employee's own payslips. Download links are signed and expire 7 days after generation. */
export function PayslipsScreen() {
  const { spacing } = useTheme();
  // Deliberately a plain query, not useOfflineQuery: payslips are personal salary documents
  // and their signed links expire, so nothing is mirrored into the offline cache.
  const query = useQuery({ queryKey: queryKeys.payslips, queryFn: fetchPayslips });

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

  // Judged at the moment the list was fetched: reading the clock during render is impure.
  const now = query.dataUpdatedAt;
  return (
    <Screen padded={false}>
      <FlatList
        data={query.data}
        keyExtractor={(p) => p.payslip_id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        renderItem={({ item }) => {
          const expired = new Date(item.signed_url_expires_at).getTime() < now;
          return (
            <Card>
              <Text variant="heading">{item.pay_period}</Text>
              <View style={{ marginVertical: spacing.sm }}>
                <Text>Net {formatCurrency(item.net_salary, item.currency_code)}</Text>
                <Text variant="caption" tone="muted">
                  Gross {formatCurrency(item.gross_salary, item.currency_code)}
                </Text>
              </View>
              {expired ? (
                <Text variant="caption" tone="muted">
                  Link expired - ask HR to regenerate it.
                </Text>
              ) : (
                <Button
                  title="Open payslip"
                  icon="document-text"
                  variant="secondary"
                  size="sm"
                  onPress={() => void Linking.openURL(item.signed_url).catch(() => toast.error('Unable to open the payslip.'))}
                />
              )}
            </Card>
          );
        }}
        ListEmptyComponent={<EmptyState icon="document-text-outline" title="No payslips yet" message="HR has not generated any for you." />}
      />
    </Screen>
  );
}
