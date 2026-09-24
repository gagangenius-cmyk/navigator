import { useState } from 'react';
import { View } from 'react-native';
import { Button, Input, Sheet, Text } from '@/components';
import { API_BASE_URL } from '@/constants/config';
import { getApiBaseUrl } from '@/services/api/baseUrl';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { hostOf, normalizeServerUrl } from '@/utils/serverUrl';

interface ServerSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Lets a tester of an internal build point the app at local, staging or production without a
 * rebuild. Only reachable from the login screen (so no session can straddle two servers) and only
 * rendered in non-production builds - see ALLOW_SERVER_OVERRIDE.
 */
export function ServerSheet({ visible, onClose }: ServerSheetProps) {
  const { spacing } = useTheme();
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const [value, setValue] = useState(getApiBaseUrl());
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const save = () => {
    // http is allowed here because this control only exists in internal builds (LAN / dev servers).
    const result = normalizeServerUrl(value, { allowHttp: true });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setServerUrl(result.url === API_BASE_URL ? null : result.url);
    setValue(result.url);
    close();
  };

  const reset = () => {
    setServerUrl(null);
    setValue(API_BASE_URL);
    close();
  };

  return (
    <Sheet visible={visible} onClose={close} title="Server">
      <View style={{ gap: spacing.md }}>
        <Text tone="muted">
          The CRM backend this app talks to. Use your computer&apos;s address on the same Wi-Fi (for example http://192.168.0.10:3000), or a deployed https URL.
        </Text>
        <Input
          label="Server address"
          value={value}
          onChangeText={(text) => {
            setValue(text);
            if (error) setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://crm.example.com"
          error={error}
          hint={API_BASE_URL ? `Build default: ${hostOf(API_BASE_URL)}` : 'This build has no default server'}
        />
        <Button title="Save" onPress={save} fullWidth />
        {API_BASE_URL ? <Button title="Use the build default" variant="ghost" onPress={reset} fullWidth /> : null}
      </View>
    </Sheet>
  );
}
