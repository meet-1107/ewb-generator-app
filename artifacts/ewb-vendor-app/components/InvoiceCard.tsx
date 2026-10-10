import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { formatDate, formatInr, invoiceEwbMeta, invoiceTotals, type Invoice } from '@/lib/domain';
import { Card, StatusPill, TextBlock } from '@/components/AppUI';

export default function InvoiceCard({ invoice, onPress, onLongPress, onDelete }: { invoice: Invoice; onPress: () => void; onLongPress?: () => void; onDelete?: () => void }) {
  const colors = useColors();
  const total = invoiceTotals(invoice).total;
  const meta = invoiceEwbMeta(invoice);
  const tint = meta.tone === 'green' ? [colors.successBackground, colors.successForeground] : meta.tone === 'amber' ? [colors.warningBackground, colors.warningForeground] : [colors.muted, colors.mutedForeground];
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={`${invoice.buyerName || 'No buyer'}, invoice ${invoice.invoiceNumber || 'without number'}, ${formatInr(total)}, ${meta.label}`} accessibilityHint={onLongPress ? 'Long press for more actions' : undefined}>
      {({ pressed }) => (
        <Card style={[styles.card, pressed ? { opacity: 0.88, transform: [{ scale: 0.995 }] } : undefined] as never}>
          <View style={styles.top}>
            <View style={[styles.icon, { backgroundColor: tint[0] }]}>
              <Feather name={meta.icon} size={17} color={tint[1]} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <TextBlock size={15} weight="semibold" numberOfLines={1}>{invoice.buyerName || 'Buyer not added'}</TextBlock>
              <View style={styles.numberRow}>
                <View style={[styles.number, { backgroundColor: colors.accent }]}>
                  <TextBlock size={12} weight="bold" color={colors.primary} numberOfLines={1}>{invoice.invoiceNumber || 'No number'}</TextBlock>
                </View>
                <TextBlock size={12} color={colors.mutedForeground} numberOfLines={1}>{formatDate(invoice.invoiceDate)}</TextBlock>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <TextBlock size={15} weight="bold">{formatInr(total)}</TextBlock>
            </View>
          </View>
          <View style={styles.bottom}>
            <StatusPill label={meta.label} tone={meta.tone} />
            {invoice.ewbNumber && invoice.ewbId ? (
              <Pressable onPress={() => router.push(`/ewb/${invoice.ewbId}`)} hitSlop={8} style={styles.ewbLink} accessibilityRole="link" accessibilityLabel={`Open e-way bill ${invoice.ewbNumber}`}>
                <Feather name="truck" size={12} color={colors.primary} />
                <TextBlock size={12} weight="semibold" color={colors.primary}>{invoice.ewbNumber}</TextBlock>
              </Pressable>
            ) : invoice.sourceFileName ? (
              <View style={styles.ewbLink}><Feather name="paperclip" size={12} color={colors.mutedForeground} /><TextBlock size={11} color={colors.mutedForeground}>From PDF</TextBlock></View>
            ) : <View style={{ flex: 1 }} />}
            {onDelete ? (
              <Pressable onPress={onDelete} hitSlop={8} style={({ pressed }) => [styles.delete, { opacity: pressed ? 0.6 : 1 }]} accessibilityRole="button" accessibilityLabel={`Delete invoice ${invoice.invoiceNumber || ''}`} testID="invoice-delete">
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </Pressable>
            ) : null}
          </View>
        </Card>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 11, borderRadius: 18 },
  top: { flexDirection: 'row', gap: 11, alignItems: 'center' },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 51 },
  delete: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  number: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 1 },
  ewbLink: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28 },
});
