import { useQuery } from '@tanstack/react-query';
import * as Device from 'expo-device';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Switch, View } from 'react-native';
import { Button, Card, Chip, Divider, ListRow, Screen, SectionHeader, Text } from '@/components';
import { APP_BUILD, APP_ENV, APP_VERSION } from '@/constants/config';
import { getApiBaseUrl } from '@/services/api/baseUrl';
import { authenticate, getBiometricSupport } from '@/services/security/biometrics';
import { getPushPermission, registerDeviceToken, requestPushPermission, type PushPermission } from '@/services/push/registerDevice';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore, type ThemeMode } from '@/store/settingsStore';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { hostOf } from '@/utils/serverUrl';

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function SettingsScreen() {
  const { colors, spacing } = useTheme();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const biometricLock = useSettingsStore((s) => s.biometricLock);
  const setBiometricLock = useSettingsStore((s) => s.setBiometricLock);
  const signOut = useSessionStore((s) => s.signOut);

  const support = useQuery({ queryKey: ['biometric-support'], queryFn: getBiometricSupport, staleTime: 60_000 });
  const [permission, setPermission] = useState<PushPermission>('undetermined');

  const refreshPermission = useCallback(() => void getPushPermission().then(setPermission), []);
  useEffect(refreshPermission, [refreshPermission]);

  const toggleLock = async (next: boolean) => {
    if (!next) {
      setBiometricLock(false);
      return;
    }
    if (!support.data?.available) {
      Alert.alert('Not available', 'Set up a fingerprint, Face ID or a device passcode in your phone settings first.');
      return;
    }
    // Prove the user can actually unlock before turning the lock on, so it can't lock them out.
    const outcome = await authenticate('Confirm to turn on the app lock');
    if (outcome === 'success') setBiometricLock(true);
  };

  const enableNotifications = async () => {
    const result = await requestPushPermission();
    setPermission(result);
    if (result === 'granted') {
      const token = await registerDeviceToken();
      toast[token ? 'success' : 'info'](token ? 'Notifications enabled' : 'Notifications allowed, but this device could not register for push.');
    } else {
      // Denied (or the OS will not ask again): the only way back is the system settings page.
      void Linking.openSettings();
    }
  };

  return (
    <Screen scroll>
      <SectionHeader title="Appearance" />
      <Card>
        <View style={{ flexDirection: 'row' }}>
          {THEMES.map((t) => (
            <Chip key={t.value} label={t.label} selected={themeMode === t.value} onPress={() => setThemeMode(t.value)} />
          ))}
        </View>
      </Card>

      <SectionHeader title="Security" />
      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        <ListRow
          title={`Lock with ${support.data?.label ?? 'biometrics'}`}
          subtitle={support.data?.available === false ? 'Set up a screen lock on your phone first' : 'Ask to unlock when the app opens or has been in the background'}
          icon="lock-closed"
          chevron={false}
          right={
            <Switch
              value={biometricLock}
              onValueChange={(v) => void toggleLock(v)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Lock with biometrics"
            />
          }
        />
      </Card>
      <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm, marginHorizontal: spacing.xs }}>
        Approving discounts, payments and sign-offs always asks for {support.data?.label ?? 'biometrics'}, whether or not the app lock is on.
      </Text>

      <SectionHeader title="Notifications" />
      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        <ListRow
          title="Push notifications"
          subtitle={permission === 'granted' ? 'On - new leads and approvals will alert you' : permission === 'denied' ? 'Blocked in system settings' : 'Off - tap to turn on'}
          icon="notifications"
          chevron={false}
          right={permission === 'granted' ? undefined : <Button title={permission === 'denied' ? 'Open settings' : 'Enable'} size="sm" variant="secondary" onPress={() => void enableNotifications()} />}
        />
        {Platform.OS === 'android' && permission === 'granted' ? (
          <>
            <Divider />
            <ListRow title="Sounds and channels" subtitle="Customise how leads and approvals alert you" icon="options" onPress={() => void Linking.openSettings()} />
          </>
        ) : null}
      </Card>

      <SectionHeader title="About" />
      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        <ListRow title={`Version ${APP_VERSION} (${APP_BUILD})`} subtitle={APP_ENV === 'production' ? undefined : `${APP_ENV} build`} icon="information-circle" chevron={false} />
        <Divider />
        <ListRow title="Server" subtitle={hostOf(getApiBaseUrl())} icon="server" chevron={false} />
        <Divider />
        <ListRow title="Device" subtitle={Device.modelName ?? Platform.OS} icon="phone-portrait" chevron={false} />
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button
          title="Sign out"
          variant="outline"
          icon="log-out"
          onPress={() =>
            Alert.alert('Sign out?', 'Saved data on this phone will be removed.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
            ])
          }
          fullWidth
        />
      </View>
    </Screen>
  );
}
