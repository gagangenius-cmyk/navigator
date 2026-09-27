import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Chip } from './ui/Badge';
import { Text } from './ui/Text';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

/** Options whose label is the value itself. */
export const toOptions = <T extends string>(values: readonly T[]): ChipOption<T>[] => values.map((value) => ({ value, label: value }));

interface ChipGroupProps<T extends string> {
  label: string;
  options: readonly ChipOption<T>[];
  value: T | null | undefined;
  onSelect: (value: T) => void;
}

/**
 * A labelled single-choice field. Options wrap onto extra lines instead of scrolling sideways, so
 * every choice is visible without the user having to discover that the row moves.
 */
export function ChipGroup<T extends string>({ label, options, value, onSelect }: ChipGroupProps<T>) {
  const { spacing } = useTheme();
  return (
    <View>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
        {label}
      </Text>
      <View style={[styles.row, { rowGap: spacing.sm }]}>
        {options.map((option) => (
          <Chip key={option.value} label={option.label} selected={value === option.value} onPress={() => onSelect(option.value)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap' } });
