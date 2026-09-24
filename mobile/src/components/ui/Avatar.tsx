import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { initials } from '@/utils/format';
import { Text } from './Text';

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="label" tone="primary" style={{ fontSize: size * 0.34 }}>
        {initials(name)}
      </Text>
    </View>
  );
}
