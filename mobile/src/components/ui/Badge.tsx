import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { Tone } from '@/theme/tokens';
import { Text } from './Text';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { colors, radius } = useTheme();
  const t = colors.tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.background, borderColor: t.border, borderRadius: radius.pill }]}>
      <Text variant="caption" style={{ color: t.foreground, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  count?: number;
}

/** A tappable filter pill. */
export function Chip({ label, selected = false, onPress, count }: ChipProps) {
  const { colors, radius, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
        },
      ]}
    >
      <Text variant="label" style={{ color: selected ? colors.onPrimary : colors.text }}>
        {label}
        {count !== undefined ? `  ${count}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  chip: { borderWidth: 1, height: 34, justifyContent: 'center', marginRight: 8 },
});
