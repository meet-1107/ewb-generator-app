import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { IconButton, TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

/** App logo and name, for the top of the Dashboard and Account screens. */
export function BrandBar({ right }: { right?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.bar}>
      <Image source={require('@/assets/images/icon.png')} style={[styles.logo, { borderColor: colors.border }]} accessibilityIgnoresInvertColors />
      <TextBlock size={18} weight="bold" color={colors.primary} style={{ flex: 1, letterSpacing: -0.3 }} accessibilityRole="header">E-Way Easy</TextBlock>
      {right}
    </View>
  );
}

/** Top-corner shortcut to the Account screen, used on the tab screens. */
export function AccountButton() {
  const colors = useColors();
  return <IconButton icon="user" accessibilityLabel="Open account" onPress={() => router.push('/account')} filled color={colors.primary} />;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 34, height: 34, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
});
