import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUiStore, type ToastKind } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { Tone } from '@/theme/tokens';
import { Icon, type IconName } from './ui/Icon';
import { Text } from './ui/Text';

const TONE: Record<ToastKind, Tone> = { success: 'success', error: 'danger', info: 'info' };
const ICON: Record<ToastKind, IconName> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

/** Renders transient messages above everything else. Mounted once at the app root. */
export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  const { colors, radius, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + spacing.sm, paddingHorizontal: spacing.lg }]}>
      {toasts.map((t) => {
        const tone = colors.tones[TONE[t.kind]];
        return (
          <Pressable
            key={t.id}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            onPress={() => dismiss(t.id)}
            style={[
              styles.toast,
              { backgroundColor: tone.background, borderColor: tone.border, borderRadius: radius.md, marginBottom: spacing.sm },
            ]}
          >
            <Icon name={ICON[t.kind]} size={20} color={tone.foreground} />
            <Text variant="label" style={{ color: tone.foreground, flex: 1, marginLeft: 10 }}>
              {t.text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, zIndex: 1000 },
  toast: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: 12 },
});
