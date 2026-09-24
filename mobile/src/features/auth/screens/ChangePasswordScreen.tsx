import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Input, Screen, Text } from '@/components';
import { errorMessage } from '@/services/api/errors';
import { useSessionStore } from '@/store/sessionStore';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { changePassword } from '../authApi';
import { MIN_PASSWORD_LENGTH, validateNewPassword } from '../passwordRules';

/**
 * Used both as the blocking screen after an HR reset (mustChangePassword) and as a
 * normal profile action. The server does not enforce mustChangePassword, so the app
 * is the gate: nothing else is reachable until this succeeds.
 */
export function ChangePasswordScreen({ forced = false }: { forced?: boolean }) {
  const navigation = useNavigation();
  const markPasswordChanged = useSessionStore((s) => s.markPasswordChanged);
  const signOut = useSessionStore((s) => s.signOut);
  const { spacing } = useTheme();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const problem = validateNewPassword(current, next, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      markPasswordChanged();
      toast.success('Password updated');
      if (!forced && navigation.canGoBack()) navigation.goBack();
    } catch (e) {
      setError(errorMessage(e, 'Unable to change your password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll keyboardAvoiding edges={forced ? ['top', 'bottom', 'left', 'right'] : undefined}>
      {forced ? (
        <View style={{ marginBottom: spacing.xl }}>
          <Text variant="title">Set a new password</Text>
          <Text tone="muted" style={{ marginTop: spacing.xs }}>
            Your password was reset by an administrator. Choose a new one to continue.
          </Text>
        </View>
      ) : null}
      <View style={{ gap: spacing.md }}>
        <Input label="Current password" value={current} onChangeText={setCurrent} password autoCapitalize="none" editable={!busy} />
        <Input
          label="New password"
          value={next}
          onChangeText={setNext}
          password
          autoCapitalize="none"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters`}
          editable={!busy}
        />
        <Input
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          password
          autoCapitalize="none"
          editable={!busy}
          onSubmitEditing={submit}
          error={error}
        />
        <Button title="Update password" onPress={submit} loading={busy} disabled={!current || !next || !confirm} fullWidth />
        {forced ? <Button title="Sign out" onPress={() => void signOut()} variant="ghost" fullWidth /> : null}
      </View>
    </Screen>
  );
}
