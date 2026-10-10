import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

/** Large tappable card used for e-way bill actions (Part-B, consolidate, cancel, download…). */
export function ActionCard({ icon, title, detail, onPress, disabled, busy, danger, testID }: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  detail?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const fg = danger ? colors.dangerForeground : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy }}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: danger ? colors.dangerBackground : colors.card, borderColor: danger ? colors.dangerBorder : colors.border },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: danger ? colors.card : colors.accent }]}>
        {busy ? <ActivityIndicator size="small" color={fg} /> : <Feather name={icon} size={18} color={fg} />}
      </View>
      <TextBlock size={14} weight="bold" color={danger ? colors.dangerForeground : undefined}>{title}</TextBlock>
      {detail ? <TextBlock size={11} color={danger ? colors.dangerForeground : colors.mutedForeground} numberOfLines={2}>{detail}</TextBlock> : null}
    </Pressable>
  );
}

/** Two-column grid of ActionCards. */
export function ActionGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{React.Children.map(children, (child) => (child ? <View style={styles.cell}>{child}</View> : null))}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexBasis: '47%', flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 6, minHeight: 112 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
