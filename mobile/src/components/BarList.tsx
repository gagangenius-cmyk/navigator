import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { formatNumber } from '@/utils/format';
import { Text } from './ui/Text';

export interface BarItem {
  label: string;
  value: number;
}

/** Horizontal bar breakdown (status / source / priority). Pure views: no chart library needed. */
export function BarList({ items, max = 8 }: { items: BarItem[]; max?: number }) {
  const { colors, radius, spacing } = useTheme();
  const rows = items.slice(0, max);
  const top = Math.max(...rows.map((r) => r.value), 1);

  if (!rows.length) return <Text tone="muted">No data yet.</Text>;
  return (
    <View>
      {rows.map((row) => (
        <View key={row.label} style={{ marginBottom: spacing.sm }} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
          <View style={styles.labels}>
            <Text variant="caption" numberOfLines={1} style={styles.label}>
              {row.label}
            </Text>
            <Text variant="caption" tone="muted">
              {formatNumber(row.value)}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }]}>
            <View
              style={[styles.fill, { width: `${Math.max((row.value / top) * 100, 3)}%`, backgroundColor: colors.primary, borderRadius: radius.pill }]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { flex: 1, marginRight: 8 },
  track: { height: 8, overflow: 'hidden' },
  fill: { height: 8 },
});
