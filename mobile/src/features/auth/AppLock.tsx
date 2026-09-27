import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from '@/components';
import { authenticate, getBiometricSupport } from '@/services/security/biometrics';
import { selectStatus, useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';

// Re-lock after the app has been in the background this long. Short enough to protect a
// phone left on a desk, long enough not to nag when switching to the dialer and back.
export const RELOCK_AFTER_MS = 30_000;

/** Decides when the app locks. Mount once, inside the providers. */
export function useAppLock(): void {
  const enabled = useSettingsStore((s) => s.biometricLock);
  const status = useSessionStore(selectStatus);
  const setLocked = useUiStore((s) => s.setLocked);
  const backgroundedAt = useRef<number | null>(null);

  // Cold start (or sign-in) with the lock enabled: start locked. useLayoutEffect, not
  // useEffect - RootNavigator reads `status` directly and can mount AppStack in the same
  // commit `status` flips to 'signedIn', so a plain effect leaves a one-frame window where
  // Home paints before the lock overlay commits.
  useLayoutEffect(() => {
    if (enabled && status === 'signedIn') setLocked(true);
    if (!enabled || status !== 'signedIn') setLocked(false);
  }, [enabled, status, setLocked]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      // Only a real background counts. The system biometric prompt briefly makes the app
      // 'inactive', and locking on that would loop.
      if (next === 'background') {
        backgroundedAt.current = Date.now();
      } else if (next === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (enabled && status === 'signedIn' && since && Date.now() - since > RELOCK_AFTER_MS) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled, status, setLocked]);
}

/** Full-screen cover shown while the app is locked. */
export function LockScreen() {
  const { colors, spacing } = useTheme();
  const setLocked = useUiStore((s) => s.setLocked);
  const setBiometricLock = useSettingsStore((s) => s.setBiometricLock);
  const signOut = useSessionStore((s) => s.signOut);
  const [label, setLabel] = useState('Biometrics');
  const [failed, setFailed] = useState(false);
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setFailed(false);
    try {
      const outcome = await authenticate('Unlock Navigator CRM');
      if (outcome === 'success') {
        setLocked(false);
      } else if (outcome === 'unavailable') {
        // The user removed their last fingerprint / passcode: never lock them out of the app.
        setBiometricLock(false);
        setLocked(false);
      } else {
        setFailed(true);
      }
    } finally {
      prompting.current = false;
    }
  }, [setBiometricLock, setLocked]);

  useEffect(() => {
    void getBiometricSupport().then((s) => setLabel(s.label));
    void unlock();
  }, [unlock]);

  return (
    <View style={[styles.cover, { backgroundColor: colors.background, padding: spacing.xl }]} accessibilityViewIsModal>
      <Icon name="lock-closed" size={56} color={colors.primary} />
      <Text variant="title" style={{ marginTop: spacing.lg }}>
        Navigator CRM is locked
      </Text>
      <Text tone="muted" align="center" style={{ marginTop: spacing.xs }}>
        {failed ? "That didn't work. Try again." : `Use ${label} to continue.`}
      </Text>
      <View style={{ marginTop: spacing.xl, gap: spacing.sm, alignSelf: 'stretch' }}>
        <Button title={`Unlock with ${label}`} onPress={() => void unlock()} icon="finger-print" fullWidth />
        <Button title="Sign out" onPress={() => void signOut()} variant="ghost" fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
});
