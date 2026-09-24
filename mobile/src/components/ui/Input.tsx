import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH } from '@/theme/tokens';
import { Icon } from './Icon';
import { Text } from './Text';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
  /** Shows a show/hide toggle; implies secureTextEntry. */
  password?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, password = false, style, multiline, ...rest },
  ref,
) {
  const { colors, radius, spacing, typography } = useTheme();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.input,
            borderColor: error ? colors.danger : focused ? colors.primary : colors.border,
            borderRadius: radius.md,
            minHeight: multiline ? 96 : MIN_TOUCH + 4,
          },
        ]}
      >
        <TextInput
          ref={ref}
          {...rest}
          multiline={multiline}
          secureTextEntry={password && !revealed}
          placeholderTextColor={colors.placeholder}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[
            typography.body,
            styles.input,
            { color: colors.text, paddingHorizontal: spacing.md, textAlignVertical: multiline ? 'top' : 'center' },
            style,
          ]}
        />
        {password ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            style={styles.toggle}
          >
            <Icon name={revealed ? 'eye-off-outline' : 'eye-outline'} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'stretch' },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  input: { flex: 1, paddingVertical: 10 },
  toggle: { paddingHorizontal: 12, height: '100%', justifyContent: 'center' },
});
