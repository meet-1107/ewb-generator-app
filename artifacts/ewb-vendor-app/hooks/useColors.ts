import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * Returns the design tokens for the current color scheme. The Account screen
 * can override the system appearance via `Appearance.setColorScheme`, which
 * flows through `useColorScheme` here.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius, isDark: scheme === 'dark' };
}
