import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Input, Screen, Text } from '@/components';
import type { AppStackParamList } from '@/navigation/types';
import { errorMessage } from '@/services/api/errors';
import type { PickedFile } from '@/services/api/upload';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { useSendMail } from '../hooks';

const MAX_BYTES = 4 * 1024 * 1024; // server request-body ceiling

interface Attachment extends PickedFile {
  size: number;
}

const formatSize = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** New message / reply / forward. Always sent from the signed-in user's own mailbox. */
export function MailComposeScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const { params } = useRoute<RouteProp<AppStackParamList, 'MailCompose'>>();
  const { colors, spacing } = useTheme();
  const send = useSendMail();
  const draft = params?.draft;

  const [to, setTo] = useState(draft?.to ?? '');
  const [cc, setCc] = useState(draft?.cc ?? '');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(Boolean(draft?.cc));
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [files, setFiles] = useState<Attachment[]>([]);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  const attach = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    const picked = result.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType || 'application/octet-stream', size: a.size ?? 0 }));
    if (totalBytes + picked.reduce((s, f) => s + f.size, 0) > MAX_BYTES) {
      Alert.alert('Too large', 'Attachments are limited to 4 MB in total.');
      return;
    }
    setFiles((prev) => [...prev, ...picked]);
  };

  const submit = () => {
    if (!to.trim()) return toast.error('Add at least one recipient.');
    if (!subject.trim() || !body.trim()) return toast.error('Subject and message are required.');
    send.mutate(
      { to, cc, bcc, subject, body, inReplyTo: draft?.inReplyTo ?? null, leadId: draft?.leadId ?? null, files },
      {
        onSuccess: () => {
          toast.success('Email sent');
          navigation.goBack();
        },
        onError: (e) => toast.error(errorMessage(e, 'Unable to send the email.')),
      },
    );
  };

  const confirmClose = () => {
    if (!body.trim() || body === (draft?.body ?? '')) return navigation.goBack();
    Alert.alert('Discard this message?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <Screen scroll keyboardAvoiding>
      <View style={{ gap: spacing.md }}>
        <Input label="To" value={to} onChangeText={setTo} placeholder="name@example.com, another@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
        {showCc ? (
          <>
            <Input label="Cc" value={cc} onChangeText={setCc} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
            <Input label="Bcc" value={bcc} onChangeText={setBcc} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          </>
        ) : (
          <Pressable onPress={() => setShowCc(true)} accessibilityRole="button"><Text variant="caption" tone="primary">Add Cc / Bcc</Text></Pressable>
        )}
        <Input label="Subject" value={subject} onChangeText={setSubject} />
        <Input label="Message" value={body} onChangeText={setBody} multiline style={{ minHeight: 180, textAlignVertical: 'top' }} />

        {files.map((f, i) => (
          <View key={`${f.name}-${i}`} style={[styles.file, { borderColor: colors.border }]}>
            <Icon name="attach" size={16} color={colors.textMuted} />
            <Text numberOfLines={1} style={{ flex: 1 }}>{f.name}</Text>
            <Text variant="caption" tone="muted">{formatSize(f.size)}</Text>
            <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} onPress={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
              <Icon name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}

        <View style={styles.actions}>
          <Button title="Attach" icon="attach" variant="outline" onPress={() => void attach()} style={{ flex: 1 }} />
          <Button title="Send" icon="send" onPress={submit} loading={send.isPending} style={{ flex: 1 }} />
        </View>
        <Button title="Cancel" variant="ghost" onPress={confirmClose} disabled={send.isPending} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  file: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  actions: { flexDirection: 'row', gap: 12 },
});
