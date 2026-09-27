import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
  /** Leading icon, tinted with the field's state (muted, focused, error). */
  icon?: IconName;
  /** Shows a show/hide toggle; implies secureTextEntry. */
  password?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, icon, password = false, style, multiline, ...rest },
  ref,
) {
  const { colors, radius, spacing, typography } = useTheme();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);

  const disabled = rest.editable === false;
  // Focus and error get a heavier outline. The padding shrinks by the same amount, so the text does not shift.
  const emphasised = focused || !!error;
  const stateColor = error ? colors.danger : focused ? colors.primary : colors.textMuted;

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
            borderColor: error ? colors.danger : focused ? colors.primary : colors.inputBorder,
            borderWidth: emphasised ? 2 : 1,
            padding: emphasised ? 0 : 1,
            borderRadius: radius.md,
            minHeight: multiline ? 96 : MIN_TOUCH + 4,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
      >
        {icon ? (
          <View style={{ paddingLeft: spacing.md }}>
            <Icon name={icon} color={stateColor} />
          </View>
        ) : null}
        <TextInput
          ref={ref}
          // A password is never auto-capitalised, auto-corrected or spell-checked (the keyboard would learn it).
          {...(password ? { autoCapitalize: 'none', autoCorrect: false, spellCheck: false } : null)}
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
            {
              color: colors.text,
              paddingLeft: icon ? spacing.sm : spacing.md,
              paddingRight: password ? spacing.xs : spacing.md,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            style,
          ]}
        />
        {password ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            accessibilityState={{ selected: revealed, disabled }}
            disabled={disabled}
            onPress={() => setRevealed((v) => !v)}
            style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
          >
            <Icon name={revealed ? 'eye-off-outline' : 'eye-outline'} size={22} color={revealed ? colors.primary : colors.textMuted} />
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
  field: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, paddingVertical: 10 },
  // Fills the field's height (alignSelf) rather than '100%', which collapses when the parent only has a minHeight.
  toggle: { width: MIN_TOUCH, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  togglePressed: { opacity: 0.5 },
});
