import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { KeyboardAvoider } from './KeyboardAvoider';
import { OfflineBanner } from './StateViews';

interface ScreenProps {
  children: React.ReactNode;
  /** Wrap content in a ScrollView. Leave off when the child is a FlatList. */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Horizontal + vertical content padding. */
  padded?: boolean;
  /** Screens under a native header only need the bottom inset. */
  edges?: Edge[];
  keyboardAvoiding?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/** Themed, safe-area-aware screen container used by every screen. */
export function Screen({
  children,
  scroll = false,
  refreshing = false,
  onRefresh,
  padded = true,
  edges = ['bottom', 'left', 'right'],
  keyboardAvoiding = false,
  contentStyle,
}: ScreenProps) {
  const { colors, spacing } = useTheme();
  const padding = padded ? spacing.lg : 0;

  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[{ padding, paddingBottom: padding + spacing.xl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, { padding }, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      {keyboardAvoiding ? <KeyboardAvoider>{body}</KeyboardAvoider> : body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
