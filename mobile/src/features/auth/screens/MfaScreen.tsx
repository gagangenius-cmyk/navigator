import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Input, Screen, Text } from '@/components';
import { errorMessage, isApiError } from '@/services/api/errors';
import { useSessionStore } from '@/store/sessionStore';
import { useTheme } from '@/theme/ThemeProvider';
import { formatAuthenticatorCode, formatBackupCode, isCompleteAuthenticatorCode, isCompleteBackupCode } from '../mfaCode';

export function MfaScreen() {
  const navigation = useNavigation();
  const verifyMfa = useSessionStore((s) => s.verifyMfa);
  const { spacing } = useTheme();

  const [code, setCode] = useState('');
  // Backup codes contain letters and a hyphen, which a number pad cannot type, so they get their own mode.
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = (useBackup ? isCompleteBackupCode(code) : isCompleteAuthenticatorCode(code)) && !busy;

  const switchMode = () => {
    setUseBackup((v) => !v);
    setCode('');
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(code);
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
        {useBackup
          ? 'Enter one of your backup codes. Each code works once.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </Text>
      <View style={{ gap: spacing.lg }}>
        {/* Keyed by mode so the field remounts, re-focuses and picks up the other keyboard. */}
        <Input
          key={useBackup ? 'backup' : 'authenticator'}
          label={useBackup ? 'Backup code' : 'Verification code'}
          icon={useBackup ? 'key-outline' : 'shield-checkmark-outline'}
          value={code}
          onChangeText={(text) => {
            setCode(useBackup ? formatBackupCode(text) : formatAuthenticatorCode(text));
            if (error) setError(null);
          }}
          keyboardType={useBackup ? 'default' : 'number-pad'}
          autoCapitalize={useBackup ? 'characters' : 'none'}
          autoCorrect={false}
          spellCheck={false}
          autoComplete={useBackup ? 'off' : 'one-time-code'}
          textContentType={useBackup ? undefined : 'oneTimeCode'}
          maxLength={useBackup ? 11 : 6}
          placeholder={useBackup ? 'XXXXX-XXXXX' : '123456'}
          returnKeyType="go"
          autoFocus
          editable={!busy}
          onSubmitEditing={submit}
          error={error}
        />
        <Button title="Verify" onPress={submit} loading={busy} disabled={!canSubmit} fullWidth />
        <Button
          title={useBackup ? 'Use authenticator code instead' : 'Use a backup code instead'}
          onPress={switchMode}
          variant="secondary"
          disabled={busy}
          fullWidth
        />
        <Button title="Back to sign in" onPress={() => navigation.goBack()} variant="ghost" fullWidth />
      </View>
    </Screen>
  );
}
