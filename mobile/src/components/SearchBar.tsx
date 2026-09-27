import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH } from '@/theme/tokens';
import { Icon } from './ui/Icon';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChangeText, placeholder = 'Search' }: SearchBarProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.input,
          borderColor: focused ? colors.primary : colors.inputBorder,
          borderWidth: focused ? 2 : 1,
          borderRadius: radius.md,
          minHeight: MIN_TOUCH,
          paddingLeft: focused ? spacing.md - 1 : spacing.md,
          // The clear button brings its own inset when it is shown.
          paddingRight: value ? 0 : spacing.md,
        },
      ]}
    >
      <Icon name="search" size={18} color={focused ? colors.primary : colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={[typography.body, styles.input, { color: colors.text }]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} style={styles.clear}>
          <Icon name="close-circle" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, paddingVertical: 8 },
  // A full-height, 44pt-wide target instead of a bare 18pt icon.
  clear: { width: MIN_TOUCH, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
});
