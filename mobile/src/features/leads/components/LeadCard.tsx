import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Badge, Card, Icon, Text } from '@/components';
import { leadStatusTone, priorityTone } from '@/theme/status';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCurrency, timeAgo } from '@/utils/format';
import { callPhone } from '@/utils/phone';
import { leadName, leadPhone, type LeadListItem, type LeadStatusOption } from '../types';

interface LeadCardProps {
  lead: LeadListItem;
  statuses?: LeadStatusOption[];
  onPress: () => void;
}

function LeadCardBase({ lead, statuses, onPress }: LeadCardProps) {
  const { colors, spacing } = useTheme();
  const name = leadName(lead);
  const phone = leadPhone(lead);
  const status = lead.status || 'New';
  const badgeClass = statuses?.find((s) => s.name.toLowerCase() === status.toLowerCase())?.badge_class;
  const balance = Number(lead.payBalance) || 0;
  const interest = [lead.service_interest_label, lead.country_interest_label].filter(Boolean).join(' · ');

  return (
    <Card onPress={onPress} accessibilityLabel={`${name}, ${status}`}>
      <View style={styles.top}>
        <Avatar name={name} />
        <View style={styles.identity}>
          <Text variant="heading" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {interest || lead.market_source_label || `Lead #${lead.id}`}
          </Text>
        </View>
        {phone ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${name}`}
            hitSlop={10}
            onPress={() => void callPhone(phone)}
            style={[styles.call, { backgroundColor: colors.primarySoft }]}
          >
            <Icon name="call" size={18} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.badges, { marginTop: spacing.md }]}>
        <Badge label={status} tone={leadStatusTone(status, badgeClass)} />
        {lead.priority ? <Badge label={lead.priority} tone={priorityTone(lead.priority)} /> : null}
        {lead.lead_score_label ? <Badge label={lead.lead_score_label} tone="accent" /> : null}
      </View>

      {lead.latest_remark ? (
        <Text variant="caption" tone="muted" numberOfLines={2} style={{ marginTop: spacing.sm }}>
          “{lead.latest_remark}”
        </Text>
      ) : null}

      <View style={[styles.footer, { marginTop: spacing.sm }]}>
        <Text variant="caption" tone="muted" numberOfLines={1} style={styles.owner}>
          {lead.assigned_to_name ? `Owner: ${lead.assigned_to_name}` : 'Unassigned'} · {timeAgo(lead.created)}
        </Text>
        {balance > 0 ? (
          <Text variant="caption" tone="warning" style={{ fontWeight: '600' }}>
            Due {formatCurrency(balance)}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

export const LeadCard = memo(LeadCardBase);

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identity: { flex: 1 },
  call: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  owner: { flex: 1 },
});
