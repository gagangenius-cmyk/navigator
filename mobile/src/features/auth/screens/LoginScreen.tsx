import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Image, StyleSheet, View, type TextInput } from 'react-native';
import { Button, Input, Screen, Text } from '@/components';
import { ALLOW_SERVER_OVERRIDE } from '@/constants/config';
import { getApiBaseUrl, getConfigProblem } from '@/services/api/baseUrl';
import type { AuthStackParamList } from '@/navigation/types';
import { errorMessage, isApiError } from '@/services/api/errors';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { hostOf } from '@/utils/serverUrl';
import { ServerSheet } from '../components/ServerSheet';

const logo = require('../../../../assets/logo.png');
// The navy logo disappears on a dark background, so dark mode uses a white silhouette.
const logoLight = require('../../../../assets/logo-light.png');

export function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const login = useSessionStore((s) => s.login);
  const signOutReason = useSessionStore((s) => s.signOutReason);
  const { spacing, isDark } = useTheme();

  const passwordRef = useRef<TextInput>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  useSettingsStore((state) => state.serverUrl); // re-render when the server changes
  const configProblem = getConfigProblem();

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy && !configProblem;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await login(username.trim(), password);
      if (outcome === 'mfa') navigation.navigate('Mfa');
      // 'success': the root navigator swaps to the app stack on its own.
    } catch (e) {
      if (isApiError(e) && e.kind === 'rate_limited') {
        const minutes = e.retryAfterSeconds ? Math.ceil(e.retryAfterSeconds / 60) : null;
        setError(minutes ? `Too many attempts. Try again in ${minutes} min.` : e.message);
      } else {
        setError(errorMessage(e, 'Unable to sign in.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll keyboardAvoiding edges={['top', 'bottom', 'left', 'right']} contentStyle={styles.content}>
      <View style={styles.brand}>
        <Image source={isDark ? logoLight : logo} style={styles.logo} resizeMode="contain" accessibilityLabel="Global Navigator" />
        <Text variant="title" style={{ marginTop: spacing.md }}>
          Navigator CRM
        </Text>
        <Text tone="muted">Sign in with your staff account</Text>
      </View>

      {signOutReason === 'expired' ? (
        <Text tone="warning" style={{ marginBottom: spacing.md }} accessibilityRole="alert">
          Your session ended. Please sign in again.
        </Text>
      ) : null}
      {configProblem ? (
        <Text tone="danger" style={{ marginBottom: spacing.md }} accessibilityRole="alert">
          {configProblem}
        </Text>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <Input
          label="Username"
          icon="person-outline"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!busy}
        />
        <Input
          ref={passwordRef}
          label="Password"
          icon="lock-closed-outline"
          value={password}
          onChangeText={setPassword}
          password
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
          error={error}
        />
        <Button title="Sign in" onPress={submit} loading={busy} disabled={!canSubmit} fullWidth />
      </View>

      {ALLOW_SERVER_OVERRIDE ? (
        <View style={{ marginTop: spacing.xl, alignItems: 'center' }}>
          <Button
            title={`Server: ${getApiBaseUrl() ? hostOf(getApiBaseUrl()) : 'not set'}`}
            variant="ghost"
            size="sm"
            icon="server"
            onPress={() => setServerOpen(true)}
            accessibilityLabel="Change server"
          />
          <ServerSheet key={String(serverOpen)} visible={serverOpen} onClose={() => setServerOpen(false)} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: 32 },
  logo: { width: 160, height: 88 },
});
