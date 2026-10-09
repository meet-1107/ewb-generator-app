/**
 * Semantic design tokens for the mobile app. `useColors()` picks the palette
 * for the active appearance (system, or the user's override in Account).
 * Both palettes keep body text and primary buttons at WCAG AA contrast.
 */

const light = {
  text: '#17231c',
  tint: '#175b42',

  background: '#f6f5ef',
  foreground: '#17231c',
  card: '#ffffff',
  cardForeground: '#17231c',
  elevated: '#ffffff',

  primary: '#175b42',
  primaryForeground: '#ffffff',
  secondary: '#e8eee7',
  secondaryForeground: '#1c4635',

  muted: '#eeeee7',
  mutedForeground: '#5f6a63',

  accent: '#e6efdf',
  accentForeground: '#275b39',
  warmAccent: '#e2a04a',
  warmAccentSoft: '#f7ecd8',
  heroStart: '#164e3a',
  heroEnd: '#103a2d',
  heroText: '#fffdf6',
  heroMuted: '#d2e0d5',
  heroDecoration: 'rgba(247, 236, 216, 0.10)',

  successBackground: '#e5f1e7',
  successForeground: '#27603b',
  warningBackground: '#fff4e8',
  warningForeground: '#8a5713',
  warningBorder: '#eed6b7',
  infoBackground: '#eaf0e5',
  dangerBackground: '#fbeae7',
  dangerForeground: '#9e3328',
  dangerBorder: '#f1c9c2',

  destructive: '#b83f32',
  destructiveForeground: '#ffffff',

  border: '#e3e4db',
  input: '#cfd4ca',
  overlay: 'rgba(14, 22, 18, 0.48)',
  shadow: '#0d1a13',
};

const dark: typeof light = {
  text: '#eef2ec',
  tint: '#5cc596',

  background: '#0d1411',
  foreground: '#eef2ec',
  card: '#141e19',
  cardForeground: '#eef2ec',
  elevated: '#1a2620',

  primary: '#4cbb8b',
  primaryForeground: '#04120b',
  secondary: '#1c2a23',
  secondaryForeground: '#cfe6d8',

  muted: '#19231e',
  mutedForeground: '#9aaba1',

  accent: '#1b3128',
  accentForeground: '#9ad7b6',
  warmAccent: '#eab062',
  warmAccentSoft: '#33281a',
  heroStart: '#15463a',
  heroEnd: '#0a241b',
  heroText: '#fffdf6',
  heroMuted: '#bcd0c3',
  heroDecoration: 'rgba(247, 236, 216, 0.10)',

  successBackground: '#16301f',
  successForeground: '#8bd8a8',
  warningBackground: '#2c2213',
  warningForeground: '#f1bd6c',
  warningBorder: '#4a3a1f',
  infoBackground: '#17251e',
  dangerBackground: '#341915',
  dangerForeground: '#f4a59b',
  dangerBorder: '#5a2a23',

  destructive: '#c44a3e',
  destructiveForeground: '#ffffff',

  border: '#24322b',
  input: '#33443b',
  overlay: 'rgba(0, 0, 0, 0.62)',
  shadow: '#000000',
};

const colors = {
  light,
  dark,
  radius: 18,
};

export type Palette = typeof light;
export default colors;
