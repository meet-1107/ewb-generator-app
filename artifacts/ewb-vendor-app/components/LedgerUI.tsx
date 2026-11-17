import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

type IconName = keyof typeof Feather.glyphMap;

/** The green balance card at the top of Bank entry, Cash entry, Expenses and Party ledger. */
export function BalanceHero({ label, amount, detail, split, action, onAction, testID }: {
  label: string;
  amount?: string;
  detail?: string;
  split?: { label: string; value: string }[];
  action?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <LinearGradient colors={[colors.heroStart, colors.heroEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero} testID={testID}>
      <View style={styles.heroTop}>
        <TextBlock size={11} weight="bold" color={colors.heroMuted} style={{ letterSpacing: 1.2, flex: 1 }} numberOfLines={1}>{label.toUpperCase()}</TextBlock>
        {action && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
            <TextBlock size={12} weight="semibold" color={colors.warmAccent}>{action}</TextBlock>
          </Pressable>
        ) : null}
      </View>
      {amount ? <TextBlock size={30} weight="bold" color={colors.heroText} style={{ letterSpacing: -0.5 }} fit>{amount}</TextBlock> : null}
      {detail ? <TextBlock size={12} color={colors.heroMuted}>{detail}</TextBlock> : null}
      {split?.length ? (
        <View style={styles.split}>
          {split.map((item) => (
            <View key={item.label} style={styles.splitCell}>
              <TextBlock size={11} color={colors.heroMuted}>{item.label}</TextBlock>
              <TextBlock size={16} weight="bold" color={colors.heroText} fit>{item.value}</TextBlock>
            </View>
          ))}
        </View>
      ) : null}
    </LinearGradient>
  );
}

const TONES = {
  in: (c: ReturnType<typeof useColors>) => ({ bg: c.successBackground, fg: c.successForeground }),
  out: (c: ReturnType<typeof useColors>) => ({ bg: c.dangerBackground, fg: c.dangerForeground }),
  move: (c: ReturnType<typeof useColors>) => ({ bg: c.infoBackground, fg: c.primary }),
  neutral: (c: ReturnType<typeof useColors>) => ({ bg: c.secondary, fg: c.primary }),
};

/** One money row: icon, title and detail on the left, amount (and a small line under it) on the right. */
export function MoneyRow({ icon, tone, title, detail, amount, amountTone, sub, onPress, testID }: {
  icon: IconName;
  tone: keyof typeof TONES;
  title: string;
  detail?: string;
  amount: string;
  amountTone?: 'in' | 'out';
  sub?: string;
  onPress?: () => void;
  testID?: string;
}) {
  const colors = useColors();
  const t = TONES[tone](colors);
  return (
    <Pressable onPress={onPress} disabled={!onPress} testID={testID} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={[styles.icon, { backgroundColor: t.bg }]}><Feather name={icon} size={16} color={t.fg} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Never cut: long party names wrap onto more lines. */}
        <TextBlock size={14} weight="semibold">{title}</TextBlock>
        {detail ? <TextBlock size={12} color={colors.mutedForeground} numberOfLines={2}>{detail}</TextBlock> : null}
      </View>
      {/* Amounts up to crores stay on one line (shrinking if needed); the title gives way. */}
      <View style={{ alignItems: 'flex-end', maxWidth: '46%' }}>
        <TextBlock size={14} weight="bold" color={amountTone === 'in' ? colors.successForeground : amountTone === 'out' ? colors.dangerForeground : colors.foreground} numberOfLines={1} fit>{amount}</TextBlock>
        {sub ? <TextBlock size={11} color={colors.mutedForeground} numberOfLines={1} fit>{sub}</TextBlock> : null}
      </View>
    </Pressable>
  );
}

/** A card holding rows, with hairlines between them. */
export function RowsCard({ children }: { children: ReactNode }) {
  const colors = useColors();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 4 }]}>
      {items.map((child, index) => (
        <View key={index} style={index ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : undefined}>{child}</View>
      ))}
    </View>
  );
}

export function DateLabel({ children }: { children: string }) {
  const colors = useColors();
  return <TextBlock size={11} weight="bold" color={colors.mutedForeground} style={{ letterSpacing: 0.8, marginTop: 4, marginLeft: 4 }}>{children.toUpperCase()}</TextBlock>;
}

/** Big "Money in / Money out" buttons. */
export function InOutButtons({ inLabel, outLabel, onIn, onOut, inIcon = 'arrow-down-left', outIcon = 'arrow-up-right', testID }: { inLabel: string; outLabel: string; onIn: () => void; onOut: () => void; inIcon?: IconName; outIcon?: IconName; testID?: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Pressable onPress={onIn} testID={testID ? `${testID}-in` : undefined} style={({ pressed }) => [styles.bigBtn, { backgroundColor: colors.successBackground, borderColor: colors.successForeground + '33' }, pressed && { opacity: 0.8 }]} accessibilityRole="button">
        <Feather name={inIcon} size={16} color={colors.successForeground} />
        <TextBlock size={14} weight="bold" color={colors.successForeground}>{inLabel}</TextBlock>
      </Pressable>
      <Pressable onPress={onOut} testID={testID ? `${testID}-out` : undefined} style={({ pressed }) => [styles.bigBtn, { backgroundColor: colors.dangerBackground, borderColor: colors.dangerBorder }, pressed && { opacity: 0.8 }]} accessibilityRole="button">
        <Feather name={outIcon} size={16} color={colors.dangerForeground} />
        <TextBlock size={14} weight="bold" color={colors.dangerForeground}>{outLabel}</TextBlock>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 20, padding: 16, gap: 4 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  split: { flexDirection: 'row', gap: 10, marginTop: 10 },
  splitCell: { flex: 1, backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12 },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, overflow: 'hidden' },
  bigBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 14, borderWidth: 1 },
});
