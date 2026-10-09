import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { formatDate, formatInr, invoiceTotals, type Invoice } from '@/lib/domain';
import { Card, StatusPill, TextBlock } from '@/components/AppUI';

const statusMeta = {
  draft: { label: 'Draft', tone: 'neutral' as const },
  ready: { label: 'Ready to generate', tone: 'blue' as const },
  ewb_generated: { label: 'EWB generated', tone: 'green' as const },
};

export default function InvoiceCard({ invoice, onPress, onLongPress }: { invoice: Invoice; onPress: () => void; onLongPress?: () => void }) {
  const colors = useColors();
  const total = invoiceTotals(invoice).total;
  const meta = statusMeta[invoice.status];
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={`Invoice ${invoice.invoiceNumber || 'draft'}, ${invoice.buyerName || 'no buyer'}, ${formatInr(total)}, ${meta.label}`} accessibilityHint={onLongPress ? 'Long press for more actions' : undefined}>
      {({ pressed }) => (
        <Card style={[styles.card, pressed ? { opacity: 0.88, transform: [{ scale: 0.995 }] } : undefined] as never}>
          <View style={styles.top}>
            <View style={[styles.icon, { backgroundColor: invoice.status === 'ewb_generated' ? colors.successBackground : colors.accent }]}>
              <Feather name={invoice.status === 'ewb_generated' ? 'check' : 'file-text'} size={17} color={invoice.status === 'ewb_generated' ? colors.successForeground : colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <TextBlock size={15} weight="semibold" numberOfLines={1}>{invoice.invoiceNumber || 'Untitled invoice'}</TextBlock>
              <TextBlock size={12} color={colors.mutedForeground} numberOfLines={1}>{invoice.buyerName || 'Buyer not added'} · {formatDate(invoice.invoiceDate)}</TextBlock>
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
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 51 },
  ewbLink: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28 },
});
