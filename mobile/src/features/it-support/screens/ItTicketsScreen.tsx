import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { Badge, Button, CachedBanner, Card, Chip, EmptyState, ErrorState, Icon, Input, LoadingView, Screen, Sheet, Text } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import { errorMessage } from '@/services/api/errors';
import { useOfflineQuery } from '@/services/db/useOfflineQuery';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { toast } from '@/store/uiStore';
import type { Tone } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate } from '@/utils/format';
import { createTicket, fetchMyTickets, IT_CATEGORIES, IT_PRIORITIES, type ItCategory, type ItPriority } from '../api';

const STATUS_TONE: Record<string, Tone> = {
  'IT Manager Review': 'warning',
  'Branch Manager Review': 'warning',
  'Director Review': 'accent',
  Assigned: 'info',
  'In Progress': 'info',
  'Resolved Awaiting Confirmation': 'success',
  Closed: 'neutral',
  Rejected: 'danger',
};

const PRIORITY_TONE: Record<string, Tone> = { High: 'danger', Medium: 'warning', Low: 'neutral' };

function NewTicketSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const user = useSessionStore(selectUser);
  const { spacing } = useTheme();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ItCategory | null>(null);
  const [priority, setPriority] = useState<ItPriority>('Medium');
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setTitle('');
    setDescription('');
    setCategory(null);
    setPriority('Medium');
    setCost('');
    setError(null);
    onClose();
  };

  const create = useMutation({
    mutationFn: () =>
      createTicket({ title, description, category: category!, priority, estimatedCostAed: cost ? Number(cost) : undefined }, user?.branch ?? 0),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.itTickets });
      toast.success('Ticket raised');
      close();
    },
    onError: (e) => setError(errorMessage(e, 'Unable to raise the ticket.')),
  });

  const submit = () => {
    if (!title.trim()) return setError('Give the ticket a title.');
    if (!category) return setError('Choose a category.');
    // New Procurement tickets need a cost estimate to route for approval.
    if (category === 'New Procurement' && (!cost || Number.isNaN(Number(cost)))) return setError('Enter the estimated cost in AED.');
    setError(null);
    create.mutate();
  };

  return (
    <Sheet visible={visible} onClose={close} title="Raise a ticket" dismissable={!create.isPending}>
      <View style={{ gap: spacing.md }}>
        <Input label="Title" value={title} onChangeText={setTitle} editable={!create.isPending} />
        <Input label="Details (optional)" value={description} onChangeText={setDescription} multiline editable={!create.isPending} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {IT_CATEGORIES.map((c) => (
            <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row' }}>
          {IT_PRIORITIES.map((p) => (
            <Chip key={p} label={p} selected={priority === p} onPress={() => setPriority(p)} />
          ))}
        </View>
        {category === 'New Procurement' ? <Input label="Estimated cost (AED)" value={cost} onChangeText={setCost} keyboardType="decimal-pad" editable={!create.isPending} /> : null}
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button title="Submit ticket" onPress={submit} loading={create.isPending} fullWidth />
      </View>
    </Sheet>
  );
}

export function ItTicketsScreen() {
  const { colors, spacing } = useTheme();
  const [creating, setCreating] = useState(false);
  const query = useOfflineQuery({ queryKey: queryKeys.itTickets, cacheKey: 'it-tickets', queryFn: fetchMyTickets });

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
        <Button title="Raise a ticket" icon="add-circle" onPress={() => setCreating(true)} disabled={query.data?.fromCache} fullWidth />
        {query.data ? <CachedBanner fromCache={query.data.fromCache} syncedAt={query.data.syncedAt} /> : null}
      </View>

      {query.isPending ? (
        <LoadingView />
      ) : query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={query.data?.data ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 }}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.between}>
                <Text variant="heading" numberOfLines={2} style={{ flex: 1, marginRight: 8 }}>
                  {item.title}
                </Text>
                <Badge label={item.priority} tone={PRIORITY_TONE[item.priority] ?? 'neutral'} />
              </View>
              <Text variant="caption" tone="muted" style={{ marginVertical: 4 }}>
                {item.ticket_number ?? 'Ticket'} · {item.category}
              </Text>
              <View style={styles.between}>
                <Badge label={item.workflow_status} tone={STATUS_TONE[item.workflow_status] ?? 'neutral'} />
                <View style={styles.due} accessibilityLabel={`Raised ${formatDate(item.created_at)}`}>
                  <Icon name="time-outline" size={14} color={colors.textMuted} />
                  <Text variant="caption" tone="muted" style={{ marginLeft: 4 }}>
                    {formatDate(item.created_at)}
                  </Text>
                </View>
              </View>
              {item.assigned_to_name ? (
                <Text variant="caption" tone="muted" style={{ marginTop: 6 }}>
                  Assigned to {item.assigned_to_name}
                </Text>
              ) : null}
            </Card>
          )}
          ListEmptyComponent={<EmptyState icon="hardware-chip-outline" title="No tickets" message="Raise one when something needs IT attention." />}
        />
      )}

      <NewTicketSheet visible={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  due: { flexDirection: 'row', alignItems: 'center' },
});
