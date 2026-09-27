import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Badge, CachedBanner, Card, Divider, EmptyState, ErrorState, Icon, LoadingView, Screen, SectionHeader, SegmentedControl, Text } from '@/components';
import { hasPermission } from '@/features/auth/rbac';
import type { AppStackParamList } from '@/navigation/types';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { approvalTone, leadStatusTone, priorityTone } from '@/theme/status';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCurrency, formatDate, formatDateTime, timeAgo } from '@/utils/format';
import { callPhone, openWhatsApp } from '@/utils/phone';
import { FollowUpSheet, RemarkSheet, RequestDiscountSheet, StatusSheet } from '../components/LeadSheets';
import { useLead, useLeadActivity, useLeadStatuses } from '../hooks';
import { leadName, leadPhone } from '../types';

type Tab = 'activity' | 'followups' | 'appointments';

function QuickAction({ icon, label, onPress, disabled }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, { opacity: disabled ? 0.4 : 1 }]}
    >
      <View style={[styles.actionIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={20} color={colors.primary} />
      </View>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </Pressable>
  );
}

function InfoRow({ icon, value, onPress }: { icon: React.ComponentProps<typeof Icon>['name']; value: string | null | undefined; onPress?: () => void }) {
  const { colors } = useTheme();
  if (!value) return null;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'link' : undefined} style={styles.infoRow}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <Text style={{ flex: 1, marginLeft: 10 }} tone={onPress ? 'primary' : 'default'}>
        {value}
      </Text>
    </Pressable>
  );
}

export function LeadDetailScreen() {
  const { params } = useRoute<RouteProp<AppStackParamList, 'LeadDetail'>>();
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const user = useSessionStore(selectUser);
  const { spacing } = useTheme();

  const leadQuery = useLead(params.leadId);
  const activityQuery = useLeadActivity(params.leadId);
  const statuses = useLeadStatuses();

  const [tab, setTab] = useState<Tab>('activity');
  const [statusOpen, setStatusOpen] = useState(false);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);

  const canUpdate = hasPermission(user, 'leads.update');

  if (leadQuery.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (leadQuery.isError && !leadQuery.data) {
    const notFound = (leadQuery.error as { kind?: string }).kind === 'not_found';
    return (
      <Screen>
        {notFound ? <EmptyState icon="alert-circle-outline" title="Lead not found" message="It may have been removed." /> : <ErrorState error={leadQuery.error} onRetry={() => void leadQuery.refetch()} />}
      </Screen>
    );
  }

  const lead = leadQuery.data!.data;
  const name = leadName(lead);
  const phone = leadPhone(lead);
  const status = lead.status || 'New';
  const badgeClass = statuses.data?.find((s) => s.name.toLowerCase() === status.toLowerCase())?.badge_class;
  const total = Number(lead.payTotal) || 0;
  const paid = Number(lead.paidYet) || 0;
  const balance = Number(lead.payBalance) || 0;
  const activity = activityQuery.data?.data;

  return (
    <Screen scroll refreshing={leadQuery.isRefetching} onRefresh={() => { void leadQuery.refetch(); void activityQuery.refetch(); }}>
      <CachedBanner fromCache={leadQuery.data!.fromCache} syncedAt={leadQuery.data!.syncedAt} />

      <Card>
        <View style={styles.header}>
          <Avatar name={name} size={52} />
          <View style={{ flex: 1 }}>
            <Text variant="title" numberOfLines={2}>
              {name}
            </Text>
            <View style={styles.badges}>
              <Pressable disabled={!canUpdate} onPress={() => setStatusOpen(true)} accessibilityRole="button" accessibilityLabel={`Status ${status}. Tap to change`}>
                <Badge label={canUpdate ? `${status} ▾` : status} tone={leadStatusTone(status, badgeClass)} />
              </Pressable>
              {lead.priority ? <Badge label={lead.priority} tone={priorityTone(lead.priority)} /> : null}
            </View>
          </View>
        </View>

        <View style={{ marginTop: spacing.md }}>
          <InfoRow icon="call-outline" value={phone} onPress={phone ? () => void callPhone(phone) : undefined} />
          <InfoRow icon="mail-outline" value={lead.email} onPress={lead.email ? () => void Linking.openURL(`mailto:${lead.email}`) : undefined} />
          <InfoRow icon="briefcase-outline" value={[lead.service_interest_label, lead.country_interest_label].filter(Boolean).join(' · ')} />
          <InfoRow icon="megaphone-outline" value={lead.market_source_label ? `Source: ${lead.market_source_label}` : null} />
          <InfoRow icon="person-outline" value={lead.assigned_to_name ? `Owner: ${lead.assigned_to_name}` : 'Unassigned'} />
          <InfoRow icon="location-outline" value={lead.branch_name} />
        </View>
      </Card>

      <View style={[styles.actions, { marginVertical: spacing.lg }]}>
        <QuickAction icon="call" label="Call" onPress={() => void callPhone(phone)} disabled={!phone} />
        <QuickAction icon="logo-whatsapp" label="WhatsApp" onPress={() => void openWhatsApp(phone)} disabled={!phone} />
        <QuickAction icon="chatbubble-ellipses" label="Remark" onPress={() => setRemarkOpen(true)} disabled={!canUpdate} />
        <QuickAction icon="alarm" label="Follow-up" onPress={() => setFollowUpOpen(true)} disabled={!user} />
        <QuickAction icon="pricetag" label="Discount" onPress={() => setDiscountOpen(true)} disabled={!canUpdate} />
        {hasPermission(user, 'leads.update', 'leads.create') ? (
          <QuickAction icon="create" label="Edit" onPress={() => navigation.navigate('LeadForm', { leadId: lead.id })} />
        ) : null}
      </View>

      {total > 0 ? (
        <Card>
          <View style={styles.money}>
            <View>
              <Text variant="caption" tone="muted">
                Paid
              </Text>
              <Text variant="heading" tone="success">
                {formatCurrency(paid)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="caption" tone="muted">
                Balance
              </Text>
              <Text variant="heading" tone={balance > 0 ? 'warning' : 'default'}>
                {formatCurrency(balance)}
              </Text>
            </View>
          </View>
          <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
            Total {formatCurrency(total)}
            {lead.agreement_number ? ` · ${lead.agreement_number}` : ''}
          </Text>
        </Card>
      ) : null}

      {lead.resolved_opportunity_id ? (
        <Card>
          <Text variant="heading" style={{ marginBottom: spacing.sm }}>
            Opportunity
          </Text>
          <View style={{ gap: spacing.sm }}>
            <View style={styles.rowBetween}>
              <Text tone="muted">Stage</Text>
              <Text variant="bodyStrong">{lead.opp_stage || lead.workflow_status || '—'}</Text>
            </View>
            {lead.discount_approval_status ? (
              <View style={styles.rowBetween}>
                <Text tone="muted">Discount</Text>
                <Badge label={lead.discount_approval_status} tone={approvalTone(lead.discount_approval_status)} />
              </View>
            ) : null}
            {lead.finance_status ? (
              <View style={styles.rowBetween}>
                <Text tone="muted">Accounts</Text>
                <Badge label={lead.finance_status} tone={approvalTone(lead.finance_status)} />
              </View>
            ) : null}
            {lead.compliance_status ? (
              <View style={styles.rowBetween}>
                <Text tone="muted">Compliance</Text>
                <Badge label={lead.compliance_status} tone={approvalTone(lead.compliance_status)} />
              </View>
            ) : null}
            {lead.finance_reason ? (
              <Text variant="caption" tone="danger">
                Accounts: {lead.finance_reason}
              </Text>
            ) : null}
            {lead.compliance_reason ? (
              <Text variant="caption" tone="danger">
                Compliance: {lead.compliance_reason}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      <SectionHeader title="History" />
      <SegmentedControl
        options={[
          { value: 'activity', label: 'Activity' },
          { value: 'followups', label: 'Follow-ups', badge: activity?.followUps.filter((f) => f.status === 'pending').length || undefined },
          { value: 'appointments', label: 'Meetings' },
        ]}
        value={tab}
        onChange={setTab}
      />

      <View style={{ marginTop: spacing.md }}>
        {activityQuery.isPending ? (
          <LoadingView />
        ) : !activity ? (
          <ErrorState error={activityQuery.error} onRetry={() => void activityQuery.refetch()} />
        ) : tab === 'activity' ? (
          <Card padded={false}>
            {activity.activityLog.length === 0 && activity.remarks.length === 0 ? (
              <EmptyState icon="time-outline" title="No activity yet" />
            ) : (
              <>
                {activity.activityLog.map((entry, index) => (
                  <View key={`log-${entry.id}`}>
                    {index > 0 ? <Divider /> : null}
                    <View style={{ padding: spacing.md }}>
                      <Text variant="caption" tone="muted">
                        {entry.actorName ?? 'System'} · {timeAgo(entry.created_at)}
                      </Text>
                      <Text style={{ marginTop: 2 }}>{entry.remark ?? entry.action.replace(/_/g, ' ')}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </Card>
        ) : tab === 'followups' ? (
          activity.followUps.length === 0 ? (
            <EmptyState icon="alarm-outline" title="No follow-ups" />
          ) : (
            <Card padded={false}>
              {activity.followUps.map((f, index) => (
                <View key={f.id}>
                  {index > 0 ? <Divider /> : null}
                  <View style={{ padding: spacing.md, gap: 4 }}>
                    <View style={styles.rowBetween}>
                      <Text variant="bodyStrong">{formatDateTime(f.reminder_date)}</Text>
                      <Badge label={f.status} tone={approvalTone(f.status)} />
                    </View>
                    {f.message ? <Text tone="muted">{f.message}</Text> : null}
                  </View>
                </View>
              ))}
            </Card>
          )
        ) : activity.appointments.length === 0 ? (
          <EmptyState icon="calendar-outline" title="No meetings" />
        ) : (
          <Card padded={false}>
            {activity.appointments.map((a, index) => (
              <View key={a.id}>
                {index > 0 ? <Divider /> : null}
                <View style={{ padding: spacing.md, gap: 4 }}>
                  <View style={styles.rowBetween}>
                    <Text variant="bodyStrong">
                      {formatDate(a.date)} · {a.appointtime?.slice(0, 5) ?? ''}
                    </Text>
                    <Badge label={Number(a.done) ? 'Done' : Number(a.not_done) ? 'Not done' : 'Scheduled'} tone={Number(a.done) ? 'success' : Number(a.not_done) ? 'neutral' : 'info'} />
                  </View>
                  {a.counselorName ? <Text tone="muted">With {a.counselorName}</Text> : null}
                </View>
              </View>
            ))}
          </Card>
        )}
      </View>

      <StatusSheet visible={statusOpen} onClose={() => setStatusOpen(false)} leadId={lead.id} current={lead.status} statuses={statuses.data ?? []} />
      <RemarkSheet visible={remarkOpen} onClose={() => setRemarkOpen(false)} leadId={lead.id} />
      {user ? <FollowUpSheet visible={followUpOpen} onClose={() => setFollowUpOpen(false)} leadId={lead.id} employeeId={user.id} /> : null}
      <RequestDiscountSheet
        visible={discountOpen}
        onClose={() => setDiscountOpen(false)}
        leadId={lead.id}
        opportunityId={lead.resolved_opportunity_id}
        defaultOriginalAmount={total}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  action: { alignItems: 'center', gap: 6, minWidth: 64 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  money: { flexDirection: 'row', justifyContent: 'space-between' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
