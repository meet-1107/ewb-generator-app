import React, { useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field, Notice, StatusPill, TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { formatInr, invoiceReadiness, invoiceTotals, parseRupees, type Invoice } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

const rates = [0, 5, 12, 18, 28];

export default function InvoiceEditorScreen() {
  const { id, step } = useLocalSearchParams<{ id: string; step?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [transportOpen, setTransportOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saveState, setSaveState] = useState('Saved on this device');
  const [formError, setFormError] = useState('');
  const [showBuyerChoices, setShowBuyerChoices] = useState(false);
  const priorBuyers = store.invoices
    .filter((item) => item.id !== id && item.buyerName.trim())
    .filter((item, index, all) => all.findIndex((candidate) => candidate.buyerName.toLowerCase() === item.buyerName.toLowerCase()) === index);
  const isReview = step === 'review';

  useEffect(() => {
    if (!invoice && store.isHydrated) {
      const found = store.invoices.find((item) => item.id === id);
      if (found) setInvoice(found);
      else {
        Alert.alert('Invoice not found', 'This invoice may have been removed from this device.');
        router.back();
      }
    }
  }, [id, invoice, store.invoices, store.isHydrated]);

  useEffect(() => {
    if (!invoice || !store.isHydrated) return;
    setSaveState('Saving…');
    const timer = setTimeout(() => {
      void store.saveInvoice({ ...invoice, updatedAt: new Date().toISOString() }).then(() => setSaveState('Saved on this device'));
    }, 650);
    return () => clearTimeout(timer);
  }, [invoice, store.isHydrated]);

  const update = <K extends keyof Invoice>(key: K, value: Invoice[K]) => {
    setInvoice((current) => current ? { ...current, [key]: value, updatedAt: new Date().toISOString() } : current);
    setFormError('');
  };
  const updateLine = (lineId: string, patch: Partial<Invoice['lines'][number]>) => {
    setInvoice((current) => current ? {
      ...current,
      lines: current.lines.map((line) => line.id === lineId ? { ...line, ...patch } : line),
      updatedAt: new Date().toISOString(),
    } : current);
  };
  const totals = invoice ? invoiceTotals(invoice) : null;

  const duplicateNumber = invoice && store.invoices.find((other) =>
    other.id !== invoice.id &&
    other.invoiceNumber.trim().toLowerCase() === invoice.invoiceNumber.trim().toLowerCase() &&
    other.sellerGstin.trim().toUpperCase() === invoice.sellerGstin.trim().toUpperCase(),
  );

  const saveDraft = async () => {
    Keyboard.dismiss();
    if (!invoice) return;
    const persist = async () => {
      setSaveState('Saving…');
      await store.saveInvoice({ ...invoice, status: 'draft', updatedAt: new Date().toISOString() });
      setSaveState('Saved on this device');
      Alert.alert('Draft saved', 'This invoice is saved on this device only. It has not been sent or submitted.');
    };
    if (duplicateNumber && invoice.invoiceNumber.trim()) {
      Alert.alert('Invoice number already used', `Another invoice for this GSTIN is numbered ${invoice.invoiceNumber}. Change the number, or keep saving this as a draft.`, [
        { text: 'Edit number', style: 'cancel' },
        { text: 'Save draft anyway', onPress: () => { void persist(); } },
      ]);
      return;
    }
    await persist();
  };

  const continueToReview = async () => {
    if (!invoice) return;
    const issues = invoiceReadiness(invoice);
    if (issues.length) {
      setFormError(`Add or review: ${issues.join(', ')}.`);
      return;
    }
    if (duplicateNumber) {
      setFormError(`Invoice number ${invoice.invoiceNumber} is already used for this seller GSTIN. Change the number before continuing.`);
      return;
    }
    const readyInvoice = { ...invoice, status: 'ready' as const, updatedAt: new Date().toISOString() };
    setInvoice(readyInvoice);
    await store.saveInvoice(readyInvoice);
    router.push({ pathname: '/invoice/[id]', params: { id: invoice.id, step: 'review' } });
  };

  if (!invoice || !totals) return <View style={[styles.loading, { backgroundColor: colors.background }]}><TextBlock color={colors.mutedForeground}>Opening invoice…</TextBlock></View>;

  if (isReview) {
    const issues = invoiceReadiness(invoice);
    return (
      <KeyboardAwareScrollViewCompat style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.reviewPage} keyboardShouldPersistTaps="handled">
        <View style={styles.modalTop}><Pressable onPress={() => router.back()} hitSlop={10}><Feather name="arrow-left" size={21} color={colors.foreground} /></Pressable><StatusPill label="Review before EWB" tone="amber" /></View>
        <TextBlock size={27} weight="bold">Review invoice</TextBlock>
        <Notice title="External submission is unavailable" body="Generating an e-way bill can create a government record. This build has no authorized EWB provider, so it cannot submit or report a generated bill." tone="warning" />
        {issues.length ? <Card><TextBlock weight="semibold">Items to complete</TextBlock>{issues.map((issue) => <TextBlock key={issue} size={13} color={colors.destructive}>• {issue}</TextBlock>)}</Card> : null}
        <Card>
          <TextBlock size={17} weight="semibold">{invoice.invoiceNumber || 'Invoice'}</TextBlock>
          <ReviewRow label="Date" value={invoice.invoiceDate} />
          <ReviewRow label="Seller" value={invoice.sellerName} />
          <ReviewRow label="Seller GSTIN" value={invoice.sellerGstin} />
          <ReviewRow label="Receiver" value={invoice.buyerName} />
          <ReviewRow label="Receiver GSTIN" value={invoice.buyerGstin || 'Not provided'} />
          <ReviewRow label="Place of supply" value={invoice.placeOfSupply} />
          <ReviewRow label="Supply" value={invoice.supplyType === 'intra' ? 'Within state' : 'Inter-state'} />
          <ReviewRow label="Taxable value" value={formatInr(totals.taxable)} />
          <ReviewRow label="Tax" value={formatInr(totals.tax)} />
          <ReviewRow label="Total" value={formatInr(totals.total)} strong />
          <ReviewRow label="Transporter" value={invoice.transporterName || 'Not provided'} />
          <ReviewRow label="Vehicle" value={invoice.vehicleNumber || 'Not provided'} />
          <ReviewRow label="Mode / distance" value={`${invoice.transportMode} · ${invoice.distanceKm ? `${invoice.distanceKm} km` : 'Distance not set'}`} />
        </Card>
        <Pressable onPress={() => setConfirmed((current) => !current)} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}>
          <View style={[styles.checkbox, { borderColor: confirmed ? colors.primary : colors.input, backgroundColor: confirmed ? colors.primary : 'transparent' }]}>{confirmed ? <Feather name="check" size={13} color="#fff" /> : null}</View>
          <TextBlock size={13} style={{ flex: 1, lineHeight: 19 }}>I reviewed these invoice and transport details.</TextBlock>
        </Pressable>
        <Button title="EWB provider setup required" icon="lock" disabled onPress={() => undefined} />
        <Button title="Edit invoice" secondary onPress={() => router.replace({ pathname: '/invoice/[id]', params: { id: invoice.id } })} />
        <Button title="Save draft" secondary onPress={saveDraft} />
      </KeyboardAwareScrollViewCompat>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat style={{ flex: 1 }} contentContainerStyle={styles.editorPage} keyboardShouldPersistTaps="handled" bottomOffset={96}>
        <View style={styles.modalTop}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Go back"><Feather name="arrow-left" size={21} color={colors.foreground} /></Pressable>
          <View style={{ flex: 1 }}><TextBlock size={17} weight="semibold">{invoice.invoiceNumber || 'New invoice'}</TextBlock><TextBlock size={10} color={store.storageError ? colors.destructive : colors.mutedForeground}>{store.storageError || saveState}</TextBlock></View>
          <StatusPill label={invoice.status === 'ready' ? 'Ready to review' : 'Draft'} tone={invoice.status === 'ready' ? 'green' : 'neutral'} />
        </View>
        <View style={styles.progress}>
          <ProgressStep number="1" label="Invoice" active /><View style={[styles.progressLine, { backgroundColor: colors.border }]} /><ProgressStep number="2" label="Review EWB" /><View style={[styles.progressLine, { backgroundColor: colors.border }]} /><ProgressStep number="3" label="Generated" />
        </View>
        <TextBlock size={23} weight="bold">Invoice details</TextBlock>
        <TextBlock size={12} color={colors.mutedForeground}>Only basic completeness is checked here; confirm legal rules with your provider.</TextBlock>
        <Card>
          <TextBlock size={16} weight="semibold">Seller and receiver</TextBlock>
          <Field label="Seller business name *" value={invoice.sellerName} onChangeText={(value) => update('sellerName', value)} placeholder="Business name" />
          <Field label="Seller GSTIN *" value={invoice.sellerGstin} onChangeText={(value) => update('sellerGstin', value.toUpperCase())} placeholder="15-character GSTIN" autoCapitalize="characters" />
          <Field label="Seller address" value={invoice.sellerAddress} onChangeText={(value) => update('sellerAddress', value)} placeholder="Business address" multiline />
          <Field label="Seller state" value={invoice.sellerState} onChangeText={(value) => update('sellerState', value)} placeholder="State" />
          <Field label="Seller PIN code" value={invoice.sellerPincode} onChangeText={(value) => update('sellerPincode', value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit PIN" keyboardType="number-pad" />
          <Field label="Dispatch-from address" value={invoice.dispatchFrom} onChangeText={(value) => update('dispatchFrom', value)} placeholder="If different from seller address" multiline />
          <Field label="Buyer / receiver name *" value={invoice.buyerName} onChangeText={(value) => update('buyerName', value)} placeholder="Business or person" />
          <Field label="Buyer GSTIN" value={invoice.buyerGstin} onChangeText={(value) => update('buyerGstin', value.toUpperCase())} placeholder="Where applicable" autoCapitalize="characters" />
          <Field label="Buyer address" value={invoice.buyerAddress} onChangeText={(value) => update('buyerAddress', value)} placeholder="Address" multiline />
          <Field label="Buyer state" value={invoice.buyerState} onChangeText={(value) => update('buyerState', value)} placeholder="State" />
          <Field label="Buyer PIN code" value={invoice.buyerPincode} onChangeText={(value) => update('buyerPincode', value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit PIN" keyboardType="number-pad" />
          <Field label="Ship-to address" value={invoice.shipTo} onChangeText={(value) => update('shipTo', value)} placeholder="If different from buyer address" multiline />
          {priorBuyers.length ? <>
            <Pressable onPress={() => setShowBuyerChoices((current) => !current)} style={styles.savedBuyerToggle}>
              <Feather name="users" size={15} color={colors.primary} /><TextBlock size={12} weight="semibold" color={colors.primary}>{showBuyerChoices ? 'Hide saved buyers' : 'Use buyer from a saved invoice'}</TextBlock>
            </Pressable>
            {showBuyerChoices ? <View style={styles.savedBuyerList}>{priorBuyers.map((buyer) => <Pressable key={buyer.id} onPress={() => {
              setInvoice((current) => current ? { ...current, buyerName: buyer.buyerName, buyerGstin: buyer.buyerGstin, buyerAddress: buyer.buyerAddress, buyerState: buyer.buyerState, buyerPincode: buyer.buyerPincode, shipTo: buyer.shipTo } : current);
              setShowBuyerChoices(false);
            }} style={[styles.savedBuyer, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextBlock size={12} weight="semibold">{buyer.buyerName}</TextBlock><TextBlock size={10} color={colors.mutedForeground}>{buyer.buyerGstin || 'No GSTIN saved'}</TextBlock>
            </Pressable>)}</View> : null}
          </> : null}
        </Card>
        <Card>
          <TextBlock size={16} weight="semibold">Invoice</TextBlock>
          <Field label="Invoice number *" value={invoice.invoiceNumber} onChangeText={(value) => update('invoiceNumber', value)} placeholder="For example, INV-2026-001" />
          <Field label="Invoice date *" value={invoice.invoiceDate} onChangeText={(value) => update('invoiceDate', value)} placeholder="YYYY-MM-DD" />
          <View style={{ gap: 7 }}>
            <TextBlock size={13} weight="semibold">Document type</TextBlock>
            <View style={styles.options}>{['Tax invoice', 'Bill of supply', 'Credit note'].map((item) => <Option key={item} label={item} selected={invoice.documentType === item} onPress={() => update('documentType', item)} />)}</View>
          </View>
          <Field label="Place of supply *" value={invoice.placeOfSupply} onChangeText={(value) => update('placeOfSupply', value)} placeholder="State or territory" />
          <View style={{ gap: 7 }}>
            <TextBlock size={13} weight="semibold">Supply type</TextBlock>
            <View style={styles.options}><Option label="Within state" selected={invoice.supplyType === 'intra'} onPress={() => update('supplyType', 'intra')} /><Option label="Inter-state" selected={invoice.supplyType === 'inter'} onPress={() => update('supplyType', 'inter')} /></View>
          </View>
        </Card>
        <Card>
          <View style={styles.sectionRow}><TextBlock size={16} weight="semibold">Products & charges</TextBlock><TextBlock size={11} color={colors.mutedForeground}>{invoice.lines.length} line{invoice.lines.length === 1 ? '' : 's'}</TextBlock></View>
          {invoice.lines.map((line, index) => (
            <View key={line.id} style={[styles.line, { borderColor: colors.border }]}>
              <View style={styles.sectionRow}><TextBlock size={13} weight="semibold">Line {index + 1}</TextBlock>{invoice.lines.length > 1 ? <Pressable onPress={() => update('lines', invoice.lines.filter((item) => item.id !== line.id))} hitSlop={8}><Feather name="trash-2" size={16} color={colors.destructive} /></Pressable> : null}</View>
              <Field label="Product / service *" value={line.description} onChangeText={(value) => updateLine(line.id, { description: value })} placeholder="Description" />
              <Field label="HSN / SAC" value={line.hsn} onChangeText={(value) => updateLine(line.id, { hsn: value })} placeholder="Code" keyboardType="number-pad" />
              <View style={styles.twoFields}>
                <View style={{ flex: 1 }}><Field label="Quantity" value={line.quantity} onChangeText={(value) => updateLine(line.id, { quantity: value })} placeholder="1" keyboardType="decimal-pad" /></View>
                <View style={{ flex: 1 }}><Field label="Unit" value={line.unit} onChangeText={(value) => updateLine(line.id, { unit: value })} placeholder="Nos" /></View>
              </View>
              <Field label="Taxable amount (₹) *" value={line.taxablePaise ? String((line.taxablePaise / 100).toFixed(2)) : ''} onChangeText={(value) => updateLine(line.id, { taxablePaise: parseRupees(value) })} placeholder="0.00" keyboardType="decimal-pad" />
              <View style={{ gap: 7 }}><TextBlock size={13} weight="semibold">GST rate</TextBlock><View style={styles.options}>{rates.map((rate) => <Option key={rate} label={`${rate}%`} selected={line.taxRate === rate} onPress={() => updateLine(line.id, { taxRate: rate })} compact />)}</View></View>
              <View style={styles.calculated}>
                <TextBlock size={11} color={colors.mutedForeground}>{invoice.supplyType === 'intra'
                  ? `CGST ${formatInr(Math.round(Math.round((line.taxablePaise * line.taxRate) / 100) / 2))} · SGST ${formatInr(Math.round((line.taxablePaise * line.taxRate) / 100) - Math.round(Math.round((line.taxablePaise * line.taxRate) / 100) / 2))}`
                  : `IGST ${formatInr(Math.round((line.taxablePaise * line.taxRate) / 100))}`}</TextBlock>
                <TextBlock size={12} weight="semibold">{formatInr(line.taxablePaise + Math.round((line.taxablePaise * line.taxRate) / 100))} line total</TextBlock>
              </View>
            </View>
          ))}
          <Button title="Add line item" icon="plus" secondary onPress={() => update('lines', [...invoice.lines, { id: `${Date.now()}-${invoice.lines.length}`, description: '', hsn: '', quantity: '1', unit: 'Nos', taxablePaise: 0, taxRate: 18 }])} />
          <TextBlock size={11} color={colors.mutedForeground}>Tax is calculated per line and rounded to the nearest paise. Review the total before saving.</TextBlock>
        </Card>
        <Card>
          <Pressable onPress={() => setTransportOpen((current) => !current)} style={styles.sectionRow}>
            <View style={{ flexDirection: 'row', gap: 9, alignItems: 'center' }}><Feather name="truck" size={17} color={colors.primary} /><TextBlock size={15} weight="semibold">Transport & EWB details</TextBlock></View><Feather name={transportOpen ? 'chevron-up' : 'chevron-down'} size={17} color={colors.mutedForeground} />
          </Pressable>
          {transportOpen ? <>
            <TextBlock size={12} color={colors.mutedForeground}>Optional here. Final requirements are checked by the authorized provider.</TextBlock>
            <Field label="Transporter name" value={invoice.transporterName} onChangeText={(value) => update('transporterName', value)} placeholder="Transport company" />
            <Field label="Transporter ID / GSTIN" value={invoice.transporterId} onChangeText={(value) => update('transporterId', value.toUpperCase())} placeholder="Where applicable" autoCapitalize="characters" />
            <Field label="Vehicle number" value={invoice.vehicleNumber} onChangeText={(value) => update('vehicleNumber', value.toUpperCase())} placeholder="Vehicle registration" autoCapitalize="characters" />
            <View style={{ gap: 7 }}><TextBlock size={13} weight="semibold">Transport mode</TextBlock><View style={styles.options}>{['Road', 'Rail', 'Air', 'Ship'].map((item) => <Option key={item} label={item} selected={invoice.transportMode === item} onPress={() => update('transportMode', item)} compact />)}</View></View>
            <Field label="Distance in km" value={invoice.distanceKm} onChangeText={(value) => update('distanceKm', value)} placeholder="Distance" keyboardType="number-pad" />
          </> : null}
        </Card>
        {invoice.sourceFileName ? <Notice title="PDF source linked" body={`${invoice.sourceFileName} · values have not been extracted or verified. Enter and confirm all details yourself.`} /> : null}
        {formError ? <Notice title="Review required" body={formError} tone="warning" /> : null}
      </KeyboardAwareScrollViewCompat>
      <View style={[styles.sticky, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 10 }]}>
        <View style={{ flex: 1, gap: 3 }}><TextBlock size={10} color={colors.mutedForeground}>INVOICE TOTAL</TextBlock><TextBlock size={19} weight="bold">{formatInr(totals.total)}</TextBlock></View>
        <View style={styles.stickyActions}>
          <Pressable onPress={saveDraft} style={[styles.smallAction, { borderColor: colors.border }]} accessibilityRole="button" testID="save-invoice-draft"><TextBlock size={12} weight="semibold">Save draft</TextBlock></Pressable>
          <Pressable onPress={continueToReview} style={[styles.smallAction, { backgroundColor: colors.primary, borderColor: colors.primary }]} accessibilityRole="button" testID="continue-to-ewb"><TextBlock size={12} weight="semibold" color="#fff">Review EWB</TextBlock><Feather name="arrow-right" size={14} color="#fff" /></Pressable>
        </View>
      </View>
    </View>
  );
}

function ReviewRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const colors = useColors();
  return <View style={styles.reviewRow}><TextBlock size={12} color={colors.mutedForeground}>{label}</TextBlock><TextBlock size={12} weight={strong ? 'bold' : 'medium'} style={{ maxWidth: '62%', textAlign: 'right' }}>{value || 'Not provided'}</TextBlock></View>;
}

function ProgressStep({ number, label, active = false }: { number: string; label: string; active?: boolean }) {
  const colors = useColors();
  return <View style={styles.progressStep}><View style={[styles.progressNumber, { backgroundColor: active ? colors.primary : colors.muted }]}><TextBlock size={10} weight="bold" color={active ? '#fff' : colors.mutedForeground}>{number}</TextBlock></View><TextBlock size={9} color={active ? colors.primary : colors.mutedForeground}>{label}</TextBlock></View>;
}

function Option({ label, selected, onPress, compact = false }: { label: string; selected: boolean; onPress: () => void; compact?: boolean }) {
  const colors = useColors();
  return <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.option, compact && styles.optionCompact, { backgroundColor: selected ? colors.accent : colors.background, borderColor: selected ? colors.primary : colors.border }]}><TextBlock size={compact ? 11 : 12} weight="semibold" color={selected ? colors.primary : colors.mutedForeground}>{label}</TextBlock></Pressable>;
}

const styles = StyleSheet.create({
  editorPage: { padding: 18, paddingBottom: 28, gap: 15 },
  reviewPage: { padding: 20, paddingTop: 20, paddingBottom: 30, gap: 15 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modalTop: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 43 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'center', paddingVertical: 4 },
  progressStep: { alignItems: 'center', gap: 5, minWidth: 55 },
  progressNumber: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  progressLine: { height: 1, width: 31, marginBottom: 13 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { borderWidth: 1, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10 },
  optionCompact: { paddingHorizontal: 10, paddingVertical: 7 },
  line: { borderWidth: 1, borderRadius: 15, padding: 13, gap: 13 },
  twoFields: { flexDirection: 'row', gap: 10 },
  calculated: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  sticky: { paddingHorizontal: 17, paddingTop: 11, paddingBottom: 14, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  stickyActions: { flexDirection: 'row', gap: 7 },
  smallAction: { height: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  checkbox: { width: 23, height: 23, borderWidth: 1.5, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  reviewRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  savedBuyerToggle: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7 },
  savedBuyerList: { gap: 7 },
  savedBuyer: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 3 },
});
