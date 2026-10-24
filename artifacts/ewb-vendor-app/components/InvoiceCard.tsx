import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { formatDate, formatInr, invoiceEwbMeta, invoiceTotals, isPurchase, type Invoice } from '@/lib/domain';
import { Card, StatusPill, TextBlock } from '@/components/AppUI';

/** Buyer (or a purchase's party) · invoice no. and value · date and document type · e-way bill status, one per line. */
/** `selected` is set while choosing invoices (bulk e-way bills): a check mark replaces ⋮. */
export default function InvoiceCard({ invoice, onPress, onLongPress, onMore, selected }: { invoice: Invoice; onPress: () => void; onLongPress?: () => void; onMore?: () => void; selected?: boolean }) {
  const colors = useColors();
  const total = invoiceTotals(invoice).total;
  const meta = invoiceEwbMeta(invoice);
  // A purchase is shown by the party it came from (the seller).
  const party = isPurchase(invoice) ? invoice.sellerName || 'Party not added' : invoice.buyerName || 'Buyer not added';
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={`${party}, invoice ${invoice.invoiceNumber || 'without number'}, ${formatInr(total)}, ${meta.label}`} accessibilityHint={onLongPress ? 'Long press for more actions' : undefined}>
      {({ pressed }) => (
        <Card style={[styles.card, pressed ? { opacity: 0.88, transform: [{ scale: 0.995 }] } : undefined, selected ? { borderColor: colors.primary, borderWidth: 2 } : undefined] as never}>
          <TextBlock size={16} weight="bold" numberOfLines={1}>{party}</TextBlock>
          <View style={styles.row}>
            <TextBlock size={13} weight="semibold" color={colors.primary} numberOfLines={1} style={{ flexShrink: 1 }}>{invoice.invoiceNumber || 'No number'}</TextBlock>
            <TextBlock size={16} weight="bold" style={{ flexShrink: 0 }}>{formatInr(total)}</TextBlock>
          </View>
          <View style={styles.dateRow}>
            <Feather name="calendar" size={12} color={colors.mutedForeground} />
            <TextBlock size={12} color={colors.mutedForeground} numberOfLines={1}>{formatDate(invoice.invoiceDate)} · {isPurchase(invoice) ? 'Purchase' : invoice.documentType || 'Tax invoice'}</TextBlock>
          </View>
          <View style={[styles.row, styles.bottom, { borderTopColor: colors.border }]}>
            <View style={styles.status}>
              <StatusPill label={meta.label} tone={meta.tone} icon={meta.icon} />
              {invoice.ewbNumber && invoice.ewbId ? (
                <Pressable onPress={() => router.push(`/ewb/${invoice.ewbId}`)} hitSlop={8} style={styles.ewbLink} accessibilityRole="link" accessibilityLabel={`Open e-way bill ${invoice.ewbNumber}`}>
                  <Feather name="truck" size={12} color={colors.primary} />
                  <TextBlock size={12} weight="semibold" color={colors.primary}>{invoice.ewbNumber}</TextBlock>
                </Pressable>
              ) : invoice.sourceFileName ? (
                <View style={styles.ewbLink}><Feather name="paperclip" size={12} color={colors.mutedForeground} /><TextBlock size={11} color={colors.mutedForeground}>From PDF</TextBlock></View>
              ) : null}
            </View>
            {selected !== undefined ? (
              <View style={[styles.check, { borderColor: selected ? colors.primary : colors.input, backgroundColor: selected ? colors.primary : 'transparent' }]} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}>
                {selected ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
              </View>
            ) : onMore ? (
              <Pressable onPress={onMore} hitSlop={8} style={({ pressed }) => [styles.more, { opacity: pressed ? 0.6 : 1 }]} accessibilityRole="button" accessibilityLabel={`More actions for invoice ${invoice.invoiceNumber || ''}`} testID="invoice-more">
                <Feather name="more-vertical" size={18} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        </Card>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 14, gap: 6, borderRadius: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bottom: { marginTop: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 36 },
  status: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 },
  more: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  ewbLink: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28 },
});
