// Single source of truth for the design system. The brand palette comes from the
// web app (src/app/globals.css): navy primary, warm peach surfaces, compass red.
// Every component reads colors through useTheme() so light/dark/system just work.

export const brand = {
  navy: '#1F3B63',
  navyDark: '#14273F',
  navyMedium: '#3A5C88',
  navyLight: '#6E93BE',
  peach: '#FBEAE0',
  peachSoft: '#FDF3EC',
  ink: '#2C353F',
  muted: '#585A5E',
  border: '#F0D7C7',
  red: '#D9331E',
  redDark: '#B0241E',
  gold: '#F6B44B',
  goldSoft: '#FDECD2',
} as const;

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export interface ToneColors {
  background: string;
  foreground: string;
  border: string;
}

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  textInverse: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  primarySoft: string;
  danger: string;
  onDanger: string;
  success: string;
  warning: string;
  info: string;
  accent: string;
  overlay: string;
  input: string;
  placeholder: string;
  tabBar: string;
  skeleton: string;
  tones: Record<Tone, ToneColors>;
}

export const lightColors: ThemeColors = {
  background: brand.peachSoft,
  surface: '#FFFFFF',
  surfaceAlt: brand.peach,
  text: brand.ink,
  textMuted: brand.muted,
  textInverse: '#FFFFFF',
  border: brand.border,
  borderStrong: '#E3BFA8',
  primary: brand.navy,
  primaryPressed: brand.navyDark,
  onPrimary: '#FFFFFF',
  primarySoft: '#E4EBF4',
  danger: brand.red,
  onDanger: '#FFFFFF',
  success: '#1B7F4C',
  warning: '#B26B00',
  info: '#2563A8',
  accent: '#6B4FA8',
  overlay: 'rgba(20, 39, 63, 0.45)',
  input: '#FFFFFF',
  placeholder: '#8A8D92',
  tabBar: '#FFFFFF',
  skeleton: '#F1DDCF',
  tones: {
    neutral: { background: '#EEF0F2', foreground: '#3F4650', border: '#D9DDE1' },
    info: { background: '#E2EEFB', foreground: '#1D4F8C', border: '#BCD6F2' },
    success: { background: '#DDF3E6', foreground: '#14653B', border: '#B4E0C5' },
    warning: { background: '#FDECD2', foreground: '#8A5200', border: '#F6D3A0' },
    danger: { background: '#FCE3DF', foreground: '#9E2415', border: '#F5BDB5' },
    accent: { background: '#ECE6F7', foreground: '#553C8D', border: '#D3C7EB' },
  },
};

export const darkColors: ThemeColors = {
  background: '#0F1722',
  surface: '#16212F',
  surfaceAlt: '#1C2A3D',
  text: '#EAEFF5',
  textMuted: '#9FB0C4',
  textInverse: '#0B1420',
  border: '#2A3A50',
  borderStrong: '#3A4E69',
  primary: '#8FB0DA',
  primaryPressed: '#B2C9E8',
  onPrimary: '#0B1420',
  primarySoft: '#1E3350',
  danger: '#FF7A66',
  onDanger: '#1A0704',
  success: '#5BC98A',
  warning: '#F2B04C',
  info: '#7FB3F0',
  accent: '#B7A0EA',
  overlay: 'rgba(0, 0, 0, 0.6)',
  input: '#1C2A3D',
  placeholder: '#7C8CA0',
  tabBar: '#16212F',
  skeleton: '#243448',
  tones: {
    neutral: { background: '#243040', foreground: '#C4CFDC', border: '#34455B' },
    info: { background: '#1B3350', foreground: '#9CC6F5', border: '#2C4D75' },
    success: { background: '#173B2A', foreground: '#86DDAA', border: '#24583F' },
    warning: { background: '#43300F', foreground: '#F6C87F', border: '#67491A' },
    danger: { background: '#4A1E18', foreground: '#FFA595', border: '#71322A' },
    accent: { background: '#2E2748', foreground: '#CBB9F2', border: '#463C6C' },
  },
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
} as const;

export type TypographyVariant = keyof typeof typography;

/** Minimum touch target (Apple HIG 44pt / Material 48dp). */
export const MIN_TOUCH = 44;
