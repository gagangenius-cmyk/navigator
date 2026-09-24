import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Input, Screen, Text } from '@/components';
import { errorMessage, isApiError } from '@/services/api/errors';
import { useSessionStore } from '@/store/sessionStore';
import { useTheme } from '@/theme/ThemeProvider';

export function MfaScreen() {
  const navigation = useNavigation();
  const verifyMfa = useSessionStore((s) => s.verifyMfa);
  const { spacing } = useTheme();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = code.trim().length >= 6 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(code.trim());
    } catch (e) {
      // An expired pending token cannot be retried - send them back to the password step.
      if (isApiError(e) && e.code === 'mfa_expired') {
        setError('That sign-in attempt expired. Please start again.');
        setTimeout(() => navigation.goBack(), 1200);
      } else {
        setError(errorMessage(e, 'Unable to verify the code.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll keyboardAvoiding contentStyle={{ paddingTop: spacing.xl }}>
      <Text variant="title">Two-step verification</Text>
      <Text tone="muted" style={{ marginTop: spacing.xs, marginBottom: spacing.xl }}>
        Enter the 6-digit code from your authenticator app, or one of your backup codes.
      </Text>
      <View style={{ gap: spacing.lg }}>
        <Input
          label="Verification code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={12}
          autoFocus
          editable={!busy}
          onSubmitEditing={submit}
          error={error}
        />
        <Button title="Verify" onPress={submit} loading={busy} disabled={!canSubmit} fullWidth />
        <Button title="Back to sign in" onPress={() => navigation.goBack()} variant="ghost" fullWidth />
      </View>
    </Screen>
  );
}
