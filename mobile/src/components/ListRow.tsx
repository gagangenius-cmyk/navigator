import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './ui/Icon';
import { Text } from './ui/Text';

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  chevron?: boolean;
}

/** A settings/menu style row. */
export function ListRow({ title, subtitle, icon, right, onPress, destructive = false, chevron }: ListRowProps) {
  const { colors, spacing } = useTheme();
  const showChevron = chevron ?? (!!onPress && !right);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, { paddingVertical: spacing.md, opacity: pressed ? 0.7 : 1 }]}
    >
      {icon ? (
        <View style={[styles.icon, { backgroundColor: destructive ? colors.tones.danger.background : colors.primarySoft }]}>
          <Icon name={icon} size={18} color={destructive ? colors.danger : colors.primary} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text variant="bodyStrong" tone={destructive ? 'danger' : 'default'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {showChevron ? <Icon name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
});
