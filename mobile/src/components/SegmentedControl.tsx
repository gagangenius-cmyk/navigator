import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './ui/Text';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Small count shown next to the label (e.g. pending items). */
  badge?: number;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const { colors, radius } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderColor: colors.border }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.badge ? `${option.label}, ${option.badge} pending` : option.label}
            onPress={() => onChange(option.value)}
            style={[styles.segment, { borderRadius: radius.sm, backgroundColor: selected ? colors.surface : 'transparent' }]}
          >
            <Text variant="label" style={{ color: selected ? colors.primary : colors.textMuted }} numberOfLines={1}>
              {option.label}
            </Text>
            {option.badge ? (
              <View style={[styles.badge, { backgroundColor: colors.danger }]}>
                <Text variant="caption" style={{ color: colors.onDanger, fontWeight: '700', fontSize: 11 }}>
                  {option.badge > 99 ? '99+' : option.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 3, borderWidth: StyleSheet.hairlineWidth },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
