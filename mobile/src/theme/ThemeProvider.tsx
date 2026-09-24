import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { useSettingsStore, type ThemeMode } from '@/store/settingsStore';
import {
  darkColors,
  lightColors,
  radius,
  spacing,
  typography,
  type ThemeColors,
} from './tokens';

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  isDark: boolean;
  mode: ThemeMode;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useSettingsStore((s) => s.themeMode);
  const system = useColorScheme();
  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');

  const theme = useMemo<Theme>(
    () => ({ colors: isDark ? darkColors : lightColors, spacing, radius, typography, isDark, mode }),
    [isDark, mode],
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}

/** Builds a StyleSheet from the current theme; recomputed only when the theme changes. */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<unknown>>(
  factory: (theme: Theme) => T,
): T {
  const theme = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- factory is a stable module-level function by convention
  return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
}
