import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { formatInr, invoiceTotals, type Invoice } from '@/lib/domain';
import { Card, StatusPill, TextBlock } from '@/components/AppUI';

export default function InvoiceCard({ invoice, onPress }: { invoice: Invoice; onPress: () => void }) {
  const colors = useColors();
  const total = invoiceTotals(invoice).total;
  const state = invoice.status === 'ready' ? 'Ready' : invoice.status === 'ewb_generated' ? 'EWB linked' : 'Draft';
  const tone = invoice.status === 'ready' || invoice.status === 'ewb_generated' ? 'green' : 'neutral';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open invoice ${invoice.invoiceNumber || 'draft'}`}>
      <Card style={styles.card}>
        <View style={styles.top}>
          <View style={[styles.icon, { backgroundColor: colors.accent }]}><Feather name="file-text" size={17} color={colors.primary} /></View>
          <View style={{ flex: 1, gap: 4 }}>
            <TextBlock size={14} weight="semibold">{invoice.invoiceNumber || 'Untitled invoice'}</TextBlock>
            <TextBlock size={12} color={colors.mutedForeground}>{invoice.buyerName || 'Buyer not added'} · {invoice.invoiceDate || 'Date not set'}</TextBlock>
          </View>
          <Feather name="arrow-up-right" size={16} color={colors.mutedForeground} />
        </View>
        <View style={styles.bottom}>
          <StatusPill label={state} tone={tone} />
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <TextBlock size={10} color={colors.mutedForeground}>TOTAL VALUE</TextBlock>
            <TextBlock size={15} weight="bold">{formatInr(total)}</TextBlock>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 15, gap: 13, borderRadius: 18 },
  top: { flexDirection: 'row', gap: 11, alignItems: 'center' },
  icon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 50 },
});
