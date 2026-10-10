import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { amountInWords, formatDate, formatInr, hasDispatch, hasShipTo, invoiceTotals, lineTax, type Invoice } from '@/lib/domain';

/** The invoice laid out like the printed copy, for checking before it is saved. */
export function InvoicePreview({ invoice }: { invoice: Invoice }) {
  const colors = useColors();
  const totals = invoiceTotals(invoice);
  const lines = invoice.lines.filter((line) => line.description.trim() || line.taxablePaise);
  const muted = colors.mutedForeground;
  const shipTo = hasShipTo(invoice);

  const party = (title: string, name: string, gstin: string, address: string, state: string, pincode: string) => (
    <View style={[styles.box, { borderColor: colors.border }]}>
      <TextBlock size={9} weight="bold" color={muted} style={styles.label}>{title}</TextBlock>
      <TextBlock size={13} weight="bold">{name || '—'}</TextBlock>
      {address ? <TextBlock size={11} color={muted}>{address}</TextBlock> : null}
      <TextBlock size={11} color={muted}>{[state, pincode].filter(Boolean).join(' ') || '—'}</TextBlock>
      <TextBlock size={11}>GSTIN: <TextBlock size={11} weight="semibold">{gstin || 'Unregistered'}</TextBlock></TextBlock>
    </View>
  );

  const money = (label: string, value: number, strong = false) => (
    <View style={styles.totalRow} key={label}>
      <TextBlock size={strong ? 14 : 12} weight={strong ? 'bold' : 'regular'} color={strong ? undefined : muted}>{label}</TextBlock>
      <TextBlock size={strong ? 14 : 12} weight={strong ? 'bold' : 'semibold'}>{formatInr(value)}</TextBlock>
    </View>
  );

  return (
    <View style={[styles.paper, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.head, { borderBottomColor: colors.primary }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <TextBlock size={16} weight="bold" color={colors.primary}>{invoice.sellerName || 'Your business'}</TextBlock>
          {invoice.sellerAddress ? <TextBlock size={11} color={muted}>{invoice.sellerAddress}</TextBlock> : null}
          <TextBlock size={11} color={muted}>{invoice.sellerState} {invoice.sellerPincode} · GSTIN {invoice.sellerGstin}</TextBlock>
          {hasDispatch(invoice) ? <TextBlock size={11} color={muted}>Dispatch from: {invoice.dispatchFrom || invoice.sellerAddress}, {invoice.dispatchState} {invoice.dispatchPincode}</TextBlock> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <View style={[styles.badge, { backgroundColor: colors.accent }]}><TextBlock size={9} weight="bold" color={colors.primary}>{invoice.documentType.toUpperCase()}</TextBlock></View>
          <TextBlock size={13} weight="bold">{invoice.invoiceNumber || 'No number'}</TextBlock>
          <TextBlock size={11} color={muted}>{formatDate(invoice.invoiceDate)}</TextBlock>
        </View>
      </View>

      <View style={styles.parties}>
        {party('BILL TO', invoice.buyerName, invoice.buyerGstin, invoice.buyerAddress, invoice.buyerState, invoice.buyerPincode)}
        {party('SHIP TO', invoice.buyerName, invoice.buyerGstin, shipTo ? invoice.shipTo || invoice.buyerAddress : invoice.buyerAddress, shipTo ? invoice.shipToState : invoice.buyerState, shipTo ? invoice.shipToPincode : invoice.buyerPincode)}
      </View>
      <TextBlock size={11} color={muted}>
        Place of supply: <TextBlock size={11} weight="semibold">{invoice.placeOfSupply || invoice.buyerState || '—'}</TextBlock> · {invoice.supplyType === 'intra' ? 'CGST + SGST' : 'IGST'}
      </TextBlock>

      <View style={[styles.table, { borderColor: colors.border }]}>
        <View style={[styles.tr, { backgroundColor: colors.primary }]}>
          <TextBlock size={10} weight="bold" color="#fff" style={styles.cItem}>ITEM</TextBlock>
          <TextBlock size={10} weight="bold" color="#fff" style={styles.cQty}>QTY × RATE</TextBlock>
          <TextBlock size={10} weight="bold" color="#fff" style={styles.cAmt}>AMOUNT</TextBlock>
        </View>
        {lines.length ? lines.map((line, index) => (
          <View key={line.id} style={[styles.tr, { borderTopColor: colors.border, borderTopWidth: index ? StyleSheet.hairlineWidth : 0 }]}>
            <View style={styles.cItem}>
              <TextBlock size={12} weight="semibold">{index + 1}. {line.description}</TextBlock>
              <TextBlock size={10} color={muted}>HSN {line.hsn || '—'} · GST {line.taxRate}%</TextBlock>
            </View>
            <View style={styles.cQty}>
              <TextBlock size={11}>{line.quantity} {line.unit}</TextBlock>
              {line.unitPricePaise ? <TextBlock size={10} color={muted}>× {formatInr(line.unitPricePaise)}</TextBlock> : null}
              {line.discountPaise ? <TextBlock size={10} color={muted}>− {formatInr(line.discountPaise)}</TextBlock> : null}
            </View>
            <View style={styles.cAmt}>
              <TextBlock size={12} weight="semibold">{formatInr(line.taxablePaise)}</TextBlock>
              <TextBlock size={10} color={muted}>+ {formatInr(lineTax(line))} GST</TextBlock>
            </View>
          </View>
        )) : <TextBlock size={12} color={muted} style={{ padding: 12 }}>No products added.</TextBlock>}
      </View>

      <View style={styles.totals}>
        {money('Taxable value', totals.taxable)}
        {invoice.supplyType === 'intra' ? [money('CGST', totals.cgst), money('SGST', totals.sgst)] : money('IGST', totals.igst)}
        <View style={[styles.grand, { borderTopColor: colors.primary }]}>{money('Total', totals.total, true)}</View>
      </View>
      <View style={{ gap: 2 }}>
        <TextBlock size={9} weight="bold" color={muted} style={styles.label}>AMOUNT IN WORDS</TextBlock>
        <TextBlock size={12}>{amountInWords(totals.total)}</TextBlock>
      </View>

      {invoice.bank ? (
        <View style={{ gap: 2 }}>
          <TextBlock size={9} weight="bold" color={muted} style={styles.label}>BANK DETAILS</TextBlock>
          <TextBlock size={12} weight="semibold">{invoice.bank.accountName}</TextBlock>
          <TextBlock size={11}>{invoice.bank.bankName}{invoice.bank.branch ? `, ${invoice.bank.branch}` : ''}</TextBlock>
          <TextBlock size={11}>A/c {invoice.bank.accountNumber} · IFSC {invoice.bank.ifsc}{invoice.bank.upiId ? ` · UPI ${invoice.bank.upiId}` : ''}</TextBlock>
        </View>
      ) : null}

      {invoice.vehicleNumber || invoice.transporterName || invoice.distanceKm ? (
        <View style={[styles.box, { borderColor: colors.border }]}>
          <TextBlock size={9} weight="bold" color={muted} style={styles.label}>TRANSPORT</TextBlock>
          <TextBlock size={11}>{invoice.transportMode} · Vehicle {invoice.vehicleNumber || '—'} · {invoice.distanceKm || '—'} km</TextBlock>
          {invoice.transporterName ? <TextBlock size={11}>Transporter: {invoice.transporterName}{invoice.transporterId ? ` (${invoice.transporterId})` : ''}</TextBlock> : null}
        </View>
      ) : null}
      {invoice.notes ? <TextBlock size={11} color={muted}>Notes: {invoice.notes}</TextBlock> : null}
      <TextBlock size={11} color={muted} style={{ textAlign: 'right', marginTop: 8 }}>For {invoice.sellerName} · Authorised signatory</TextBlock>
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  head: { flexDirection: 'row', gap: 10, borderBottomWidth: 2, paddingBottom: 10 },
  badge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  parties: { flexDirection: 'row', gap: 8 },
  box: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 9, gap: 2 },
  label: { letterSpacing: 0.8 },
  table: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  tr: { flexDirection: 'row', paddingHorizontal: 9, paddingVertical: 8, gap: 6 },
  cItem: { flex: 2.2, gap: 1 },
  cQty: { flex: 1.4, gap: 1 },
  cAmt: { flex: 1.5, alignItems: 'flex-end', gap: 1 },
  totals: { alignSelf: 'flex-end', width: '70%', gap: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  grand: { borderTopWidth: 2, paddingTop: 6, marginTop: 2 },
});
