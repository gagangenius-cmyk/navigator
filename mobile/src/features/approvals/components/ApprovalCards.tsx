import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Badge, Button, Card, Icon, Text } from '@/components';
import type { PaymentVerification } from '@/features/accounts/types';
import type { ComplianceApproval } from '@/features/compliances/types';
import { discountPercent, type DiscountApproval } from '@/features/discounts/types';
import { useTheme } from '@/theme/ThemeProvider';
import { approvalTone } from '@/theme/status';
import { formatCurrency, formatDate, fullName, timeAgo } from '@/utils/format';
import type { Decision } from '../decisionRules';

export type ApprovalItem =
  | { kind: 'discount'; row: DiscountApproval }
  | { kind: 'payment'; row: PaymentVerification }
  | { kind: 'compliance'; row: ComplianceApproval };

export const approvalItemKey = (item: ApprovalItem) => `${item.kind}:${item.row.id}`;
export const approvalItemId = (item: ApprovalItem) => String(item.row.id);

interface CardProps {
  item: ApprovalItem;
  highlighted?: boolean;
  /** Show the record without Approve / Reject buttons (the confirm screen). */
  hideActions?: boolean;
  onDecide: (decision: Decision) => void;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text variant="caption" tone="muted" style={styles.rowLabel}>
        {label}
      </Text>
      <Text variant="caption" style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

function LinkRow({ label, url }: { label: string; url: string | null | undefined }) {
  const { colors } = useTheme();
  if (!url) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${label}`}
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      style={styles.link}
    >
      <Icon name="document-attach-outline" size={16} color={colors.primary} />
      <Text variant="label" tone="primary" style={{ marginLeft: 6 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Actions({ pending, verb, onDecide }: { pending: boolean; verb: string; onDecide: (d: Decision) => void }) {
  if (!pending) return null;
  return (
    <View style={styles.actions}>
      <Button title="Reject" variant="outline" size="sm" icon="close" onPress={() => onDecide('reject')} style={styles.action} />
      <Button title={verb} size="sm" icon="checkmark" onPress={() => onDecide('approve')} style={styles.action} />
    </View>
  );
}

function Shell({ highlighted, children }: { highlighted?: boolean; children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Card style={highlighted ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>{children}</Card>;
}

function Header({ title, status, subtitle }: { title: string; status: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text variant="heading" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Badge label={status.replace(/_/g, ' ')} tone={approvalTone(status)} />
    </View>
  );
}

export function DiscountCard({ row, highlighted, hideActions, onDecide }: CardProps & { row: DiscountApproval }) {
  const percent = discountPercent(row);
  const currency = row.currency ?? 'AED';
  return (
    <Shell highlighted={highlighted}>
      <Header title={fullName(row.fname, row.lname, `Lead #${row.leadId}`)} status={row.status} subtitle={timeAgo(row.createdAt ?? row.requestedDate)} />
      <View style={styles.amountRow}>
        <Text variant="title">{formatCurrency(row.discountAmount, currency)}</Text>
        <Text variant="bodyStrong" tone="warning">
          {percent}% off
        </Text>
      </View>
      <Row label="Original" value={formatCurrency(row.originalAmount, currency)} />
      <Row label="After discount" value={formatCurrency(row.discountedAmount, currency)} />
      <Row label="Type" value={row.discountType} />
      <Row label="Requested by" value={row.requestedEmployeeName} />
      <Row label="Reason" value={row.reason} />
      <Actions pending={row.status === 'pending' && !hideActions} verb="Approve" onDecide={onDecide} />
    </Shell>
  );
}

export function PaymentCard({ row, highlighted, hideActions, onDecide }: CardProps & { row: PaymentVerification }) {
  const status = String(row.accountantStatus || 'pending');
  return (
    <Shell highlighted={highlighted}>
      <Header title={row.clientName?.trim() || `Lead #${row.leadId ?? ''}`} status={status} subtitle={timeAgo(row.createdAt)} />
      <View style={styles.amountRow}>
        <Text variant="title">{formatCurrency(row.paidAmount, row.currency)}</Text>
        {row.totalAmount ? (
          <Text variant="caption" tone="muted">
            of {formatCurrency(row.totalAmount, row.currency)}
          </Text>
        ) : null}
      </View>
      <Row label="Receipt" value={row.paymentNumber} />
      <Row label="Method" value={row.paymentMethod} />
      <Row label="Transaction" value={row.transactionId} />
      <Row label="Paid on" value={row.paymentDate ? formatDate(row.paymentDate) : null} />
      <Row label="Service" value={row.serviceName} />
      <Row label="Remarks" value={row.accountantRemarks} />
      <LinkRow label="Proof of payment" url={row.proofOfPaymentUrl} />
      <Actions pending={status === 'pending' && !hideActions} verb="Approve" onDecide={onDecide} />
    </Shell>
  );
}

export function ComplianceCard({ row, highlighted, hideActions, onDecide }: CardProps & { row: ComplianceApproval }) {
  const status = String(row.status || 'pending');
  const open = status === 'pending' || status === 'under_review';
  return (
    <Shell highlighted={highlighted}>
      <Header title={row.clientName?.trim() || `Lead #${row.leadId}`} status={status} subtitle={timeAgo(row.submittedAt ?? row.createdAt)} />
      <Row label="Counselor" value={row.counselorName} />
      <Row label="Receipt" value={row.receiptNumber ?? row.paymentNumber} />
      <Row label="Paid" value={row.paidAmount ? formatCurrency(row.paidAmount, row.currency ?? 'AED') : null} />
      <Row label="Finance" value={row.accountantStatus} />
      <Row label="Summary" value={row.conversationSummary} />
      <Row label="Commitments" value={row.clientCommitments} />
      <Row label="Next action" value={row.nextAction} />
      <Row label="Review notes" value={row.reviewNotes} />
      <LinkRow label="Signed agreement" url={row.signedAgreementUrl} />
      <LinkRow label="Proof of payment" url={row.proofOfPaymentUrl} />
      <LinkRow label="Counsellor sheet" url={row.counsellorSheetUrl} />
      <Actions pending={open && !hideActions} verb="Sign off" onDecide={onDecide} />
    </Shell>
  );
}

export function ApprovalCard({ item, highlighted, hideActions, onDecide }: CardProps) {
  switch (item.kind) {
    case 'discount':
      return <DiscountCard item={item} row={item.row} highlighted={highlighted} hideActions={hideActions} onDecide={onDecide} />;
    case 'payment':
      return <PaymentCard item={item} row={item.row} highlighted={highlighted} hideActions={hideActions} onDecide={onDecide} />;
    case 'compliance':
      return <ComplianceCard item={item} row={item.row} highlighted={highlighted} hideActions={hideActions} onDecide={onDecide} />;
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  headerText: { flex: 1 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginVertical: 8 },
  row: { flexDirection: 'row', paddingVertical: 2 },
  rowLabel: { width: 96 },
  rowValue: { flex: 1 },
  link: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  action: { flex: 1 },
});
