import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Divider, Sheet, TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { formatDate, formatInr, type EwbRecord } from '@/lib/domain';

/** In-app preview of the printable e-way bill (same fields as the PDF). */
export function EwbPreview({ ewb, visible, onClose, sandbox }: { ewb: EwbRecord; visible: boolean; onClose: () => void; sandbox: boolean }) {
  const colors = useColors();
  const row = (label: string, value: string) => (
    <View style={styles.row} key={label}>
      <TextBlock size={11} color={colors.mutedForeground} style={styles.label}>{label}</TextBlock>
      <TextBlock size={12} weight="semibold" style={styles.value} selectable>{value || '—'}</TextBlock>
    </View>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="E-way bill preview" subtitle={sandbox ? 'Test bill — not valid for transport' : 'As it will print'}>
      <View style={[styles.paper, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={styles.head}>
          <TextBlock size={11} weight="bold" color={colors.mutedForeground} style={{ letterSpacing: 1.5 }}>E-WAY BILL{ewb.status === 'cancelled' ? ' · CANCELLED' : ''}</TextBlock>
          <TextBlock size={22} weight="bold" style={{ letterSpacing: 2 }} selectable>{ewb.ewbNumber}</TextBlock>
        </View>
        {row('Generated', formatDate(ewb.generatedAt, true))}
        {row('Valid until', formatDate(ewb.validUntil, true))}
        {ewb.consolidatedInto ? row('Consolidated bill', ewb.consolidatedInto) : null}
        <Divider />
        <TextBlock size={12} weight="bold">Part A</TextBlock>
        {row('GSTIN of supplier', `${ewb.sellerGstin} · ${ewb.sellerName}`)}
        {row('Place of dispatch', ewb.fromState)}
        {row('GSTIN of recipient', `${ewb.buyerGstin || 'URP'} · ${ewb.buyerName}`)}
        {row('Place of delivery', ewb.toState)}
        {row('Document', `Tax invoice ${ewb.invoiceNumber} · ${formatDate(ewb.invoiceDate)}`)}
        {row('Value of goods', formatInr(ewb.totals.total))}
        {row('HSN', [...new Set(ewb.lines.map((line) => line.hsn))].join(', '))}
        {row('Reason', 'Outward — Supply')}
        <Divider />
        <TextBlock size={12} weight="bold">Part B</TextBlock>
        {row('Mode', ewb.transport.mode)}
        {row('Vehicle', ewb.transport.vehicleNumber || 'Pending')}
        {row('Transporter', [ewb.transport.transporterName, ewb.transport.transporterId].filter(Boolean).join(' · '))}
        {row('Distance', `${ewb.transport.distanceKm} km`)}
        {ewb.status === 'cancelled' ? row('Cancelled', `${formatDate(ewb.cancelledAt ?? '', true)} · ${ewb.cancelReason ?? ''}`) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  paper: { marginHorizontal: 18, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  head: { gap: 2, alignItems: 'center', paddingBottom: 4 },
  row: { flexDirection: 'row', gap: 10 },
  label: { width: 120 },
  value: { flex: 1 },
});
