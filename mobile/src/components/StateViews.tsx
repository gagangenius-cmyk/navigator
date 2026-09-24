import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { errorMessage } from '@/services/api/errors';
import { useUiStore } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { timeAgo } from '@/utils/format';
import { Button } from './ui/Button';
import { Icon, type IconName } from './ui/Icon';
import { Text } from './ui/Text';

export function LoadingView({ label }: { label?: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label ?? 'Loading'}>
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? (
        <Text tone="muted" style={{ marginTop: spacing.md }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = 'file-tray-outline', title, message, actionLabel, onAction }: EmptyStateProps) {
  const { colors, spacing } = useTheme();
  return (
    <View style={[styles.center, { padding: spacing.xl }]}>
      <Icon name={icon} size={44} color={colors.textMuted} />
      <Text variant="heading" align="center" style={{ marginTop: spacing.md }}>
        {title}
      </Text>
      {message ? (
        <Text tone="muted" align="center" style={{ marginTop: spacing.xs }}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.lg }}>
          <Button title={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={[styles.center, { padding: spacing.xl }]} accessibilityRole="alert">
      <Icon name="cloud-offline-outline" size={44} color={colors.danger} />
      <Text variant="heading" align="center" style={{ marginTop: spacing.md }}>
        Couldn’t load this
      </Text>
      <Text tone="muted" align="center" style={{ marginTop: spacing.xs }}>
        {errorMessage(error)}
      </Text>
      {onRetry ? (
        <View style={{ marginTop: spacing.lg }}>
          <Button title="Try again" onPress={onRetry} variant="secondary" icon="refresh" />
        </View>
      ) : null}
    </View>
  );
}

/** Shown app-wide while the device has no connection. */
export function OfflineBanner() {
  const offline = useUiStore((s) => s.offline);
  const { colors, spacing } = useTheme();
  if (!offline) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: colors.tones.warning.background, paddingHorizontal: spacing.lg }]}
    >
      <Icon name="cloud-offline-outline" size={16} color={colors.tones.warning.foreground} />
      <Text variant="caption" style={{ color: colors.tones.warning.foreground, marginLeft: 8 }}>
        You’re offline. Saved data is shown and changes are unavailable.
      </Text>
    </View>
  );
}

/** Shown above a list that was served from the offline cache instead of the server. */
export function CachedBanner({ fromCache, syncedAt }: { fromCache: boolean; syncedAt: number }) {
  const { colors, spacing } = useTheme();
  if (!fromCache) return null;
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: colors.tones.info.background, paddingHorizontal: spacing.lg, marginBottom: spacing.sm, borderRadius: 8 },
      ]}
    >
      <Icon name="time-outline" size={16} color={colors.tones.info.foreground} />
      <Text variant="caption" style={{ color: colors.tones.info.foreground, marginLeft: 8 }}>
        Saved data · last synced {timeAgo(new Date(syncedAt))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
});
