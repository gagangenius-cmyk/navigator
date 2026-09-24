import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { TypographyVariant } from '@/theme/tokens';

export type TextTone = 'default' | 'muted' | 'primary' | 'danger' | 'success' | 'warning' | 'inverse';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
}

export function Text({ variant = 'body', tone = 'default', align, style, ...rest }: TextProps) {
  const { colors, typography } = useTheme();
  const color = {
    default: colors.text,
    muted: colors.textMuted,
    primary: colors.primary,
    danger: colors.danger,
    success: colors.success,
    warning: colors.warning,
    inverse: colors.textInverse,
  }[tone];
  return <RNText {...rest} style={[typography[variant], { color, textAlign: align }, style]} />;
}
