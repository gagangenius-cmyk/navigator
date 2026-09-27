import { useNavigation } from '@react-navigation/native';
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
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
  const nextRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const submit = async () => {
    // Both the button and the confirm field's "Go" key call submit() - without this guard
    // a fast double-tap (or tapping the button then hitting Go before it re-renders
    // disabled) fires two concurrent changePassword() calls with the same current password.
    if (busy) return;
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
        <Input
          label="Current password"
          icon="lock-closed-outline"
          value={current}
          onChangeText={setCurrent}
          password
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="next"
          onSubmitEditing={() => nextRef.current?.focus()}
          editable={!busy}
        />
        <Input
          ref={nextRef}
          label="New password"
          icon="key-outline"
          value={next}
          onChangeText={setNext}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters`}
          editable={!busy}
        />
        <Input
          ref={confirmRef}
          label="Confirm new password"
          icon="key-outline"
          value={confirm}
          onChangeText={setConfirm}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
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
