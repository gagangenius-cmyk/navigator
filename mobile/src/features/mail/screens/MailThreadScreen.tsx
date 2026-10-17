import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, LoadingView, Screen, Text } from '@/components';
import type { AppStackParamList } from '@/navigation/types';
import { getApiBaseUrl } from '@/services/api/baseUrl';
import { errorMessage } from '@/services/api/errors';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTime } from '@/utils/format';
import { useMailAction, useMailThread } from '../hooks';
import type { ComposeDraft, MailMessage } from '../types';

const stripHtml = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();

// Plain text only on purpose: an incoming HTML email is untrusted, and the app never
// renders it in a web view (no scripts, no remote images / tracking pixels).
const bodyOf = (m: MailMessage) => (m.body_text?.trim() ? m.body_text : m.body_html ? stripHtml(m.body_html) : '(no text content)');

const formatSize = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function MailThreadScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const { params } = useRoute<RouteProp<AppStackParamList, 'MailThread'>>();
  const { colors, spacing } = useTheme();
  const thread = useMailThread(params.messageId);
  const action = useMailAction();

  const messages = thread.data ?? [];
  const last = messages[messages.length - 1];
  const ids = messages.map((m) => m.id);

  const run = (act: 'archive' | 'trash' | 'unread' | 'restore', done: string, leave = true) =>
    action.mutate(
      { ids, action: act },
      {
        onSuccess: () => { toast.info(done); if (leave) navigation.goBack(); },
        onError: (e) => toast.error(errorMessage(e, 'Unable to update this conversation.')),
      },
    );

  const quote = (m: MailMessage) =>
    `\n\n--- On ${formatDateTime(m.message_date)}, ${m.from_name || m.from_address} wrote ---\n${bodyOf(m).split('\n').map((l) => `> ${l}`).join('\n')}`;
  const withPrefix = (subject: string | null, prefix: string) => (new RegExp(`^${prefix}:`, 'i').test(subject || '') ? subject || '' : `${prefix}: ${subject || ''}`);

  const compose = (draft: ComposeDraft) => navigation.navigate('MailCompose', { draft });

  const reply = (m: MailMessage, all: boolean) => {
    const target = m.direction === 'in' ? m.from_address || '' : m.to_addresses || '';
    const others = all
      ? [...(m.to_addresses || '').split(','), ...(m.cc_addresses || '').split(',')]
          .map((a) => a.trim().toLowerCase())
          .filter((a) => a && a !== (m.from_address || '').toLowerCase() && !(m.direction === 'out' && a === target.toLowerCase()))
      : [];
    compose({ to: target, cc: others.join(', '), subject: withPrefix(m.subject, 'Re'), body: quote(m), inReplyTo: m.message_id, leadId: m.lead_id });
  };
  const forward = (m: MailMessage) =>
    compose({ subject: withPrefix(m.subject, 'Fwd'), body: `\n\n--- Forwarded message ---\nFrom: ${m.from_name || ''} <${m.from_address}>\nDate: ${formatDateTime(m.message_date)}\nSubject: ${m.subject}\n\n${bodyOf(m)}`, leadId: m.lead_id });

  // Attachments are served by an authenticated endpoint; the app has no file viewer,
  // so hand off to the system browser where the user's web session (if any) applies.
  const openAttachment = (id: number, name: string) =>
    Alert.alert(name, 'Attachments open in your browser, where you need to be signed in to the CRM.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open', onPress: () => void Linking.openURL(`${getApiBaseUrl()}/api/mail/attachments/${id}`) },
    ]);

  if (thread.isPending) return <Screen><LoadingView /></Screen>;
  if (thread.isError) return <Screen><ErrorState error={thread.error} onRetry={() => void thread.refetch()} /></Screen>;
  if (!last) return <Screen><EmptyState icon="mail-outline" title="Message not found" /></Screen>;

  return (
    <Screen scroll>
      <View style={{ gap: spacing.md }}>
        <Text variant="title">{messages[0].subject || '(no subject)'}</Text>
        {last.lead_id ? <View style={styles.row}><Badge label={`Lead: ${last.lead_name}`} tone="info" /></View> : null}

        {messages.map((m) => (
          <Card key={m.id}>
            <View style={{ gap: 2 }}>
              <Text variant="bodyStrong">{m.direction === 'out' ? 'You' : m.from_name || m.from_address}</Text>
              <Text variant="caption" tone="muted">{m.from_address} → {m.to_addresses}{m.cc_addresses ? `  ·  Cc ${m.cc_addresses}` : ''}</Text>
              <Text variant="caption" tone="muted">{formatDateTime(m.message_date)}</Text>
            </View>
            {m.error ? <Text tone="danger" style={{ marginTop: spacing.sm }}>Send failed: {m.error}</Text> : null}
            <Text selectable style={{ marginTop: spacing.md }}>{bodyOf(m)}</Text>
            {m.attachments.length > 0 ? (
              <View style={[styles.row, { marginTop: spacing.md }]}>
                {m.attachments.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => openAttachment(a.id, a.filename)}
                    accessibilityRole="button"
                    accessibilityLabel={`Attachment ${a.filename}`}
                    style={[styles.attachment, { borderColor: colors.border }]}
                  >
                    <Icon name="attach" size={16} color={colors.textMuted} />
                    <Text variant="caption" numberOfLines={1} style={{ maxWidth: 180 }}>{a.filename}</Text>
                    <Text variant="caption" tone="muted">{formatSize(a.size)}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>
        ))}

        <View style={styles.row}>
          <Button title="Reply" icon="arrow-undo" size="sm" onPress={() => reply(last, false)} />
          <Button title="Reply all" icon="arrow-undo-circle" size="sm" variant="outline" onPress={() => reply(last, true)} />
          <Button title="Forward" icon="arrow-redo" size="sm" variant="outline" onPress={() => forward(last)} />
        </View>
        <View style={styles.row}>
          {last.folder === 'trash' || last.folder === 'archive' ? (
            <Button title="Move to inbox" icon="refresh" size="sm" variant="ghost" onPress={() => run('restore', 'Moved back')} />
          ) : (
            <>
              <Button title="Archive" icon="archive" size="sm" variant="ghost" onPress={() => run('archive', 'Archived')} />
              <Button title="Trash" icon="trash" size="sm" variant="ghost" onPress={() => run('trash', 'Moved to trash')} />
            </>
          )}
          <Button title="Mark unread" icon="mail-unread" size="sm" variant="ghost" onPress={() => run('unread', 'Marked unread')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
});
