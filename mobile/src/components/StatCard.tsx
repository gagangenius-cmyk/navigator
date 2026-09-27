import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { Tone } from '@/theme/tokens';
import { Card } from './ui/Card';
import { Icon, type IconName } from './ui/Icon';
import { Text } from './ui/Text';

interface StatCardProps {
  label: string;
  value: string;
  icon?: IconName;
  tone?: Tone;
  /** Month-over-month style change, in percent. Positive is good unless `invertDelta`. */
  delta?: number | null;
  invertDelta?: boolean;
  onPress?: () => void;
}

export function StatCard({ label, value, icon, tone = 'info', delta, invertDelta = false, onPress }: StatCardProps) {
  const { colors, spacing, radius } = useTheme();
  const t = colors.tones[tone];
  const good = delta === null || delta === undefined ? null : invertDelta ? delta <= 0 : delta >= 0;

  return (
    <Card onPress={onPress} accessibilityLabel={`${label}: ${value}`} style={styles.card}>
      <View style={styles.row}>
        {icon ? (
          <View style={[styles.icon, { backgroundColor: t.background, borderRadius: radius.md }]}>
            <Icon name={icon} size={18} color={t.foreground} />
          </View>
        ) : null}
        {delta !== null && delta !== undefined ? (
          <Text variant="caption" style={{ color: good ? colors.success : colors.danger, fontWeight: '600' }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
          </Text>
        ) : null}
      </View>
      <Text variant="title" style={{ marginTop: spacing.sm }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: '46%' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
